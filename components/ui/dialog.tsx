"use client";

import * as React from "react";
import { X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

type ModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  wide?: boolean;
  children: React.ReactNode;
  footer?: React.ReactNode;
};

function Modal({ open, onOpenChange, title, description, wide, children, footer }: ModalProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="modal-overlay" />
        <DialogPrimitive.Content className={cn("modal", wide && "modal-wide")}>
          <header className="modal-head">
            <div>
              <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
              {description ? <DialogPrimitive.Description>{description}</DialogPrimitive.Description> : <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>}
            </div>
            <DialogPrimitive.Close className="icon-button" aria-label="Close">
              <X />
            </DialogPrimitive.Close>
          </header>
          <div className="modal-body">{children}</div>
          {footer ? <footer className="modal-foot">{footer}</footer> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

type ConfirmProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  children?: React.ReactNode;
};

function Confirm({ open, onOpenChange, title, description, confirmLabel, danger, onConfirm, children }: ConfirmProps) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      footer={
        <>
          <button className="secondary" onClick={() => onOpenChange(false)}>Cancel</button>
          <button
            className={danger ? "danger" : "primary"}
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      {children}
    </Modal>
  );
}

export { Modal, Confirm };
