"use client";

import { unstable_rethrow } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface ConfirmDialogItem {
  detail?: string;
  name: string;
}

/**
 * The one prompt for anything that can't be undone, so every delete looks and
 * behaves the same. Mount it only while it is open.
 *
 * It renders on the page body so the styles of whatever opened it don't reach
 * inside. As a native modal dialog, it keeps keyboard focus inside itself and
 * makes the page behind it unavailable.
 */
export function ConfirmDialog({
  action,
  children,
  confirmLabel,
  description,
  eyebrow = "Permanently delete",
  items,
  listLabel,
  moreText,
  onClose,
  pendingLabel = "Deleting…",
  title,
}: {
  /** Runs once confirmed. The dialog stays open, showing progress, until it finishes. */
  action: (formData: FormData) => Promise<void>;
  /** Hidden fields to send with the action. */
  children?: ReactNode;
  confirmLabel: string;
  description: string;
  eyebrow?: string;
  items: ConfirmDialogItem[];
  listLabel: string;
  moreText?: string;
  onClose: () => void;
  pendingLabel?: string;
  title: string;
}) {
  const ids = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const [failed, setFailed] = useState(false);
  const [pending, startAction] = useTransition();

  // Read before the dialog opens, so closing can put focus back where it was.
  const [opener] = useState(() => document.activeElement);

  useEffect(() => {
    if (!dialog.current?.open) dialog.current?.showModal();
    // Starting on Cancel means a stray Enter can't confirm something permanent.
    cancelButton.current?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [opener]);

  function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setFailed(false);
    startAction(async () => {
      try {
        await action(formData);
      } catch (error) {
        // A redirect arrives as an error, and it isn't one.
        unstable_rethrow(error);
        setFailed(true);
        return;
      }
      onClose();
    });
  }

  return createPortal(
    <dialog
      aria-describedby={`${ids}-description`}
      aria-labelledby={`${ids}-title`}
      className="modal delete-modal"
      onCancel={(event) => {
        // Escape closes it, unless the action is already running.
        event.preventDefault();
        if (!pending) onClose();
      }}
      onClose={onClose}
      ref={dialog}
      role="alertdialog"
    >
      <div className="modal-heading">
        <div className="delete-modal-title">
          <span aria-hidden="true" className="delete-modal-icon">
            <svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" /></svg>
          </span>
          <div><p className="eyebrow">{eyebrow}</p><h2 id={`${ids}-title`}>{title}</h2></div>
        </div>
        <button aria-label="Close" className="icon-button" disabled={pending} onClick={onClose} type="button">×</button>
      </div>
      <div className="delete-modal-body">
        <p id={`${ids}-description`}>{description} <strong>This cannot be undone.</strong></p>
        <ul aria-label={listLabel} className="delete-modal-list">
          {items.map((item, index) => (
            <li key={index}>
              <span aria-hidden="true">{item.name.slice(0, 1).toUpperCase()}</span>
              <div><strong>{item.name}</strong>{item.detail && <small>{item.detail}</small>}</div>
            </li>
          ))}
        </ul>
        {moreText && <p className="delete-modal-more">{moreText}</p>}
        {failed && <p className="form-message error" role="alert">That didn&apos;t go through. Check your connection and try again.</p>}
      </div>
      <form className="delete-modal-actions" onSubmit={confirm}>
        {children}
        <button className="secondary-button" disabled={pending} onClick={onClose} ref={cancelButton} type="button">Cancel</button>
        <button className="danger-button solid" disabled={pending} type="submit">{pending ? pendingLabel : confirmLabel}</button>
      </form>
    </dialog>,
    document.body,
  );
}
