"use client";

import { useCallback, useEffect, useState } from "react";

import {
  createInvite,
  listActiveInvites,
  revokeInvite,
} from "@/app/actions/shared-session";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { shortUserId } from "@/lib/format";

// Phase 7 (collab-and-quantitative-appetite) — Share drawer.
//
// Intentional carve-out to invariant #17 (single display component):
// this component references `sharedSessionId` because it ONLY renders
// inside the shared-session branch of the tracker. File is prefixed
// `share-` so the invariant's grep (`--exclude "components/share*"`)
// keeps passing.
//
// UX contract:
//   - Opens a dialog mounted from the tracker's Share button.
//   - Mints a fresh invite on open (single 24h single-use token).
//   - Renders: invite URL + Copy button, collaborator roster, and a
//     "Revoke all active invites" action that iterates the server's
//     active-invite list and calls revokeInvite() per row.
//   - Clipboard state is ephemeral (3s "Copied" flash). No toast lib.

export interface ShareDrawerCollaborator {
  userId: string;
  role: string;
}

interface ShareDrawerProps {
  sharedSessionId: string;
  collaborators: readonly ShareDrawerCollaborator[];
  currentUserId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type MintState =
  | { status: "idle" }
  | { status: "minting" }
  | { status: "ready"; token: string; inviteId: string; expiresAt: string }
  | { status: "error"; message: string };

export function ShareDrawer({
  sharedSessionId,
  collaborators,
  currentUserId,
  open,
  onOpenChange,
}: ShareDrawerProps) {
  const [mint, setMint] = useState<MintState>({ status: "idle" });
  const [copied, setCopied] = useState(false);
  const [revokePending, setRevokePending] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  // Mint a fresh invite when the drawer opens. We drop the prior token
  // on reopen — callers wanting multiple live links should use the
  // future list-view (out of scope for Phase 7).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setMint({ status: "minting" });
    setCopied(false);
    setRevokeError(null);

    (async () => {
      const result = await createInvite(sharedSessionId);
      if (cancelled) return;
      if (!result.ok) {
        setMint({
          status: "error",
          message:
            result.error === "not_owner"
              ? "Only the session owner can create invites."
              : result.error === "already_finalized"
                ? "This session is already finished."
                : "Could not generate an invite. Try again.",
        });
        return;
      }
      setMint({
        status: "ready",
        token: result.data.token,
        inviteId: result.data.id,
        expiresAt: result.data.expiresAt,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [open, sharedSessionId]);

  // Flash "Copied" for 3s without mounting a toast system.
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 3_000);
    return () => clearTimeout(t);
  }, [copied]);

  const inviteUrl =
    mint.status === "ready"
      ? `${window.location.origin}/join?token=${mint.token}`
      : "";

  const handleCopy = useCallback(async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }, [inviteUrl]);

  const handleRevokeAll = useCallback(async () => {
    if (revokePending) return;
    setRevokePending(true);
    setRevokeError(null);
    try {
      const listed = await listActiveInvites(sharedSessionId);
      if (!listed.ok) {
        setRevokeError("Could not load invites.");
        return;
      }
      // Fire revokes in parallel. Each revokeInvite is idempotent —
      // used_at is only stamped once thanks to the WHERE used_at IS NULL
      // guard inside the action.
      const results = await Promise.all(
        listed.data.map((inv) => revokeInvite(inv.id)),
      );
      const failures = results.filter((r) => !r.ok);
      if (failures.length > 0) {
        setRevokeError(
          `Revoked ${results.length - failures.length} of ${results.length} invites.`,
        );
      }
      // After a successful revoke-all, re-mint a fresh invite so the UI
      // doesn't show a token that's now marked used (the currently
      // displayed token was part of the revoke set). If the remint
      // itself fails we surface that — otherwise the drawer keeps
      // showing the just-revoked token as if it were still valid.
      const reminted = await createInvite(sharedSessionId);
      if (reminted.ok) {
        setMint({
          status: "ready",
          token: reminted.data.token,
          inviteId: reminted.data.id,
          expiresAt: reminted.data.expiresAt,
        });
      } else {
        setMint({
          status: "error",
          message:
            "Revoked, but could not generate a fresh link. Close and reopen.",
        });
      }
    } finally {
      setRevokePending(false);
    }
  }, [revokePending, sharedSessionId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite friends</DialogTitle>
          <DialogDescription>
            Anyone with this link can join and log what they eat. The link
            expires in 24 hours.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <label
            htmlFor="invite-url"
            className="text-xs font-medium tracking-[0.01em] text-muted-foreground"
          >
            Invite link
          </label>
          <div className="flex items-center gap-2">
            <Input
              id="invite-url"
              type="text"
              readOnly
              value={
                mint.status === "ready"
                  ? inviteUrl
                  : mint.status === "minting"
                    ? "Generating link…"
                    : ""
              }
              aria-busy={mint.status === "minting"}
              className="font-mono text-xs"
            />
            <Button
              type="button"
              size="sm"
              onClick={handleCopy}
              disabled={mint.status !== "ready"}
              aria-label="Copy invite link"
            >
              {copied ? "Copied" : "Copy link"}
            </Button>
          </div>
          {mint.status === "error" ? (
            <p role="alert" className="text-xs text-destructive">
              {mint.message}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium tracking-[0.01em] text-muted-foreground">
            Invited so far ({collaborators.length})
          </p>
          <ul className="flex flex-col gap-1 text-sm">
            {collaborators.length === 0 ? (
              <li className="text-muted-foreground">
                No collaborators yet.
              </li>
            ) : (
              collaborators.map((c) => (
                <li
                  key={c.userId}
                  className="flex items-center justify-between"
                >
                  <span className="text-foreground">
                    {c.userId === currentUserId
                      ? "You"
                      : shortUserId(c.userId)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {c.role}
                  </span>
                </li>
              ))
            )}
          </ul>
        </div>

        <div className="flex flex-col gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleRevokeAll}
            disabled={revokePending || mint.status !== "ready"}
          >
            {revokePending ? "Revoking…" : "Revoke all active invites"}
          </Button>
          {revokeError ? (
            <p role="alert" className="text-xs text-destructive">
              {revokeError}
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

