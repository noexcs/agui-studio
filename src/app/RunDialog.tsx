import * as Dialog from "@radix-ui/react-dialog";
import { Icon } from "../shared/Icon";
import { t } from "../i18n";

/** Run/thread details. Radix Dialog supplies overlay, focus trap and Esc. */
export function RunDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: { label: string; value: string }[];
  onCopy: () => void;
}) {
  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="run-dialog-overlay" />
        <Dialog.Content className="run-dialog-content" aria-describedby={undefined}>
          <div className="run-dialog-head">
            <Dialog.Title className="run-dialog-title">{t("dialog.title")}</Dialog.Title>
            <Dialog.Close className="run-dialog-close" aria-label={t("dialog.close")}>
              <Icon name="x" size={14} />
            </Dialog.Close>
          </div>

          <dl className="run-dialog-rows">
            {props.rows.map((row) => (
              <div key={row.label} className="run-dialog-row">
                <dt>{row.label}</dt>
                <dd className="mono">{row.value || "—"}</dd>
              </div>
            ))}
          </dl>

          <div className="run-dialog-foot">
            <button className="run-dialog-copy" onClick={props.onCopy}>
              <Icon name="copy" size={12} /> {t("dialog.copy")}
            </button>
            <Dialog.Close className="run-dialog-done">{t("dialog.close")}</Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
