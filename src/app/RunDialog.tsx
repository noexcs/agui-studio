import * as Dialog from "@radix-ui/react-dialog";
import { Icon } from "../shared/Icon";
import { t } from "../i18n";

/** Run/thread details. Radix Dialog supplies overlay, focus trap and Esc.
    Tailwind migration (task-13): app.css .run-dialog-* moved to utilities;
    the fade / pop-in keyframes stay in app.css (utilities cannot own them). */
export function RunDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: { label: string; value: string }[];
  onCopy: () => void;
}) {
  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="run-dialog-overlay fixed inset-0 z-[80] bg-[rgba(24,24,27,0.28)] backdrop-blur-[6px] animate-[fade_0.18s]" />
        <Dialog.Content className="run-dialog-content fixed left-1/2 top-1/2 z-[81] w-[min(520px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[rgba(17,17,20,0.12)] bg-white px-5 py-[18px] shadow-[0_50px_120px_-40px_rgba(24,24,27,0.3)] animate-[pop-in_0.2s_cubic-bezier(0.16,1,0.3,1)]" aria-describedby={undefined}>
          <div className="run-dialog-head mb-3 flex items-center justify-between">
            <Dialog.Title className="run-dialog-title text-[15px] font-semibold tracking-[-0.01em]">{t("dialog.title")}</Dialog.Title>
            <Dialog.Close className="run-dialog-close grid h-7 w-7 place-items-center rounded-lg text-[#52525b] hover:bg-[rgba(0,0,0,0.05)] hover:text-[#18181b]" aria-label={t("dialog.close")}>
              <Icon name="x" size={14} />
            </Dialog.Close>
          </div>

          <dl className="run-dialog-rows mb-4 mt-0 flex flex-col">
            {props.rows.map((row) => (
              <div key={row.label} className="run-dialog-row flex items-baseline justify-between gap-4 border-b border-dashed border-[rgba(17,17,20,0.1)] px-0.5 py-[7px]">
                <dt className="text-[9.5px] tracking-[0.14em] text-[#8a8a94] uppercase">{row.label}</dt>
                <dd className="mono m-0 truncate text-[10.5px] text-[#3f3f46]">{row.value || "—"}</dd>
              </div>
            ))}
          </dl>

          <div className="run-dialog-foot flex justify-end gap-2.5">
            <button className="run-dialog-copy inline-flex h-[30px] cursor-pointer items-center gap-1.5 rounded-lg border border-[rgba(17,17,20,0.14)] bg-[rgba(0,0,0,0.03)] px-[13px] text-[11.5px] text-[#18181b]" onClick={props.onCopy}>
              <Icon name="copy" size={12} /> {t("dialog.copy")}
            </button>
            <Dialog.Close className="run-dialog-done h-[30px] cursor-pointer rounded-lg border-0 bg-[rgba(124,58,237,0.1)] px-[13px] text-[11.5px] font-semibold text-[#6d28d9]">{t("dialog.close")}</Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
