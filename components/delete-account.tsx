'use client';

import { useState } from 'react';
import { useAction } from 'convex/react';
import { useAuthActions } from '@convex-dev/auth/react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/convex/_generated/api';

const CONFIRMATION_PHRASE = 'DELETE';

/**
 * Account deletion for the web app (App Store Guideline 5.1.1(v) parity with
 * iOS). Typing the confirmation phrase guards against accidental taps; the
 * server action cancels billing and removes every user-scoped record.
 */
export function DeleteAccountSection() {
  const deleteAccount = useAction(api.account.deleteAccount);
  const { signOut } = useAuthActions();
  const [isOpen, setIsOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    if (confirmation.trim().toUpperCase() !== CONFIRMATION_PHRASE) return;
    setIsDeleting(true);
    setError(null);
    try {
      await deleteAccount({ confirm: 'DELETE' });
      await signOut();
      window.location.href = '/';
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not delete your account. Please try again.',
      );
      setIsDeleting(false);
    }
  }

  return (
    <section className="rounded-2xl border border-destructive/40 bg-card/80 p-6 shadow-sm">
      <h2 className="text-lg font-semibold tracking-tight">Delete account</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Permanently deletes your account, every conversation, API keys and any
        unused credits. A subscription, if present, is cancelled. This cannot be
        undone.
      </p>

      {!isOpen ? (
        <Button
          variant="destructive"
          className="mt-4"
          onClick={() => setIsOpen(true)}
          disabled={isDeleting}
        >
          Delete account
        </Button>
      ) : (
        <div className="mt-4 space-y-3">
          <label className="block text-sm text-muted-foreground" htmlFor="delete-confirmation">
            Type <span className="font-mono font-semibold text-foreground">DELETE</span> to confirm
          </label>
          <Input
            id="delete-confirmation"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            disabled={isDeleting}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting || confirmation.trim().toUpperCase() !== CONFIRMATION_PHRASE}
            >
              {isDeleting ? 'Deleting…' : 'Permanently delete account'}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setIsOpen(false);
                setConfirmation('');
                setError(null);
              }}
              disabled={isDeleting}
            >
              Cancel
            </Button>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
      )}
    </section>
  );
}
