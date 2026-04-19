SHELL := /usr/bin/env bash
.SHELLFLAGS := -euo pipefail -c
.DEFAULT_GOAL := help

# --- Pinned tool versions --------------------------------------------------
# Bumping these is a deliberate act. Change here, then re-run `make doctor`
# on a clean laptop (or in CI) to confirm the kit still bootstraps.
KIND_VERSION          := 0.31.0
SKAFFOLD_VERSION      := 2.18.3
INGRESS_NGINX_VERSION := 1.15.1

# --- Cluster / app identifiers ---------------------------------------------
CLUSTER_NAME := aycemon
APP_NAMESPACE := aycemon
INGRESS_NAMESPACE := ingress-nginx
KIND_CONFIG := k8s/kind/config.yaml
INGRESS_MANIFEST := k8s/kind/ingress-nginx.yaml
ENV_FILE := .env.local

# --- Helpers ---------------------------------------------------------------
# kind/skaffold/kubectl do not honour a private PATH — they must be on the
# caller's PATH. `doctor` verifies this and prints the install hints.
define need
	command -v $(1) >/dev/null 2>&1 || { echo "missing: $(1) — see \`make doctor\`"; exit 1; }
endef

.PHONY: help
help: ## Show this help
	@awk 'BEGIN{FS=":.*##"; printf "\nTargets:\n"} /^[a-zA-Z_-]+:.*?##/{printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

.PHONY: doctor
doctor: ## Verify toolchain + env file are ready for `make up`
	@echo "==> Checking prerequisites"
	@$(call need,docker)
	@docker info >/dev/null 2>&1 || { echo "docker daemon not running"; exit 1; }
	@$(call need,kind)
	@actual=$$(kind version | awk '{print $$2}' | sed 's/^v//'); \
		if [ "$$actual" != "$(KIND_VERSION)" ]; then \
			echo "kind version $$actual does not match pinned $(KIND_VERSION) — install via 'brew install kind@$(KIND_VERSION)' or 'go install sigs.k8s.io/kind@v$(KIND_VERSION)'"; \
		fi
	@$(call need,kubectl)
	@$(call need,skaffold)
	@actual=$$(skaffold version | sed 's/^v//'); \
		if [ "$$actual" != "$(SKAFFOLD_VERSION)" ]; then \
			echo "skaffold version $$actual does not match pinned $(SKAFFOLD_VERSION)"; \
		fi
	@test -f $(ENV_FILE) || { echo "missing $(ENV_FILE) — copy .env.docker.example and fill in values"; exit 1; }
	@grep -q '^NEXT_PUBLIC_SUPABASE_URL=' $(ENV_FILE) || { echo "$(ENV_FILE) missing NEXT_PUBLIC_SUPABASE_URL"; exit 1; }
	@grep -q '^NEXT_PUBLIC_SUPABASE_ANON_KEY=' $(ENV_FILE) || { echo "$(ENV_FILE) missing NEXT_PUBLIC_SUPABASE_ANON_KEY"; exit 1; }
	@grep -q '^SUPABASE_SERVICE_ROLE_KEY=' $(ENV_FILE) || { echo "$(ENV_FILE) missing SUPABASE_SERVICE_ROLE_KEY"; exit 1; }
	@grep -q '^GOOGLE_PLACES_API_KEY=' $(ENV_FILE) || { echo "$(ENV_FILE) missing GOOGLE_PLACES_API_KEY"; exit 1; }
	@echo "ok"

.PHONY: cluster
cluster: ## Create the kind cluster (idempotent)
	@if kind get clusters 2>/dev/null | grep -qx "$(CLUSTER_NAME)"; then \
		echo "==> kind cluster '$(CLUSTER_NAME)' already exists"; \
	else \
		echo "==> Creating kind cluster '$(CLUSTER_NAME)'"; \
		kind create cluster --name $(CLUSTER_NAME) --config $(KIND_CONFIG) --wait 60s; \
	fi
	@kubectl cluster-info --context kind-$(CLUSTER_NAME) >/dev/null

.PHONY: ingress
ingress: cluster ## Install ingress-nginx controller + wait for readiness
	@echo "==> Applying ingress-nginx $(INGRESS_NGINX_VERSION) + app ingress"
	@# Namespace first — $(INGRESS_MANIFEST) ends with an Ingress in the
	@# aycemon namespace, which would otherwise be rejected on a cold cluster.
	@kubectl apply -f k8s/namespace.yaml
	@kubectl apply -f $(INGRESS_MANIFEST)
	@echo "==> Waiting for ingress-nginx admission webhook (up to 120s)"
	@kubectl wait --namespace $(INGRESS_NAMESPACE) \
		--for=condition=ready pod \
		--selector=app.kubernetes.io/component=controller \
		--timeout=120s

.PHONY: seed-secrets
seed-secrets: cluster ## Populate aycemon-secrets + ghcr-pull-secret placeholder from .env.local
	@bash scripts/k8s-seed-secrets.sh

.PHONY: up
up: doctor cluster ingress seed-secrets ## One-shot bootstrap: cluster + ingress + app on :8080
	@echo "==> Building image and deploying via skaffold"
	@set -a; source $(ENV_FILE); set +a; \
		skaffold run --kube-context kind-$(CLUSTER_NAME) --tail=false
	@echo ""
	@echo "==> Ready. App is at http://localhost:8080"
	@echo "    Tail logs: make logs"
	@echo "    Live rebuild on change: make dev"
	@echo "    Tear down: make down"

.PHONY: dev
dev: doctor cluster ingress seed-secrets ## Skaffold dev loop — rebuild + redeploy on file change
	@set -a; source $(ENV_FILE); set +a; \
		skaffold dev --kube-context kind-$(CLUSTER_NAME)

.PHONY: logs
logs: ## Tail app pod logs
	@kubectl logs -n $(APP_NAMESPACE) -l app=aycemon -f --tail=100

.PHONY: status
status: ## Print cluster + workload status
	@echo "==> kind clusters"
	@kind get clusters || true
	@echo ""
	@echo "==> pods ($(APP_NAMESPACE))"
	@kubectl get pods -n $(APP_NAMESPACE) || true
	@echo ""
	@echo "==> pods ($(INGRESS_NAMESPACE))"
	@kubectl get pods -n $(INGRESS_NAMESPACE) || true
	@echo ""
	@echo "==> ingress"
	@kubectl get ingress -A || true

.PHONY: down
down: ## Delete the kind cluster and all workloads
	@if kind get clusters 2>/dev/null | grep -qx "$(CLUSTER_NAME)"; then \
		echo "==> Deleting kind cluster '$(CLUSTER_NAME)'"; \
		kind delete cluster --name $(CLUSTER_NAME); \
	else \
		echo "==> No kind cluster '$(CLUSTER_NAME)' — nothing to do"; \
	fi
