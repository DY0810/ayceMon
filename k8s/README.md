# Kubernetes Quick-Start (minikube)

## Prerequisites

- [minikube](https://minikube.sigs.k8s.io/docs/start/)
- [kubectl](https://kubernetes.io/docs/tasks/tools/)

## Deploy

```bash
minikube start
minikube addons enable ingress
kubectl apply -f k8s/
```

Wait for pods to be ready:

```bash
kubectl get pods -n aycemon
```

## Access the app

Add the minikube IP to your hosts file:

```bash
echo "$(minikube ip) aycemon.local" | sudo tee -a /etc/hosts
```

Then:

```bash
curl http://aycemon.local
```

Or open [http://aycemon.local](http://aycemon.local) in your browser.
