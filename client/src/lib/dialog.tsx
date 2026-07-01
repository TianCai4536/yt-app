import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

// ---------- 通用确认 / 输入弹窗 ----------
interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  danger?: boolean;
}
interface PromptOptions {
  title: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  inputType?: string;
}

interface DialogCtx {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  prompt: (opts: PromptOptions) => Promise<string | null>;
}

const Ctx = createContext<DialogCtx | null>(null);

export function useDialog() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useDialog must be inside DialogProvider");
  return c;
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const [confirmState, setConfirmState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const [promptState, setPromptState] = useState<(PromptOptions & { resolve: (v: string | null) => void; value: string }) | null>(null);

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => setConfirmState({ ...opts, resolve }));
  }, []);
  const prompt = useCallback((opts: PromptOptions) => {
    return new Promise<string | null>((resolve) => setPromptState({ ...opts, resolve, value: opts.defaultValue || "" }));
  }, []);

  return (
    <Ctx.Provider value={{ confirm, prompt }}>
      {children}

      {confirmState && (
        <div className="modal-mask" onClick={() => { confirmState.resolve(false); setConfirmState(null); }}>
          <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
            <h3>{confirmState.title}</h3>
            <p className="modal-text">{confirmState.message}</p>
            <div className="modal-actions">
              <button onClick={() => { confirmState.resolve(false); setConfirmState(null); }}>取消</button>
              <button
                className={confirmState.danger ? "btn-danger" : "btn-primary"}
                onClick={() => { confirmState.resolve(true); setConfirmState(null); }}
              >
                {confirmState.confirmText || "确定"}
              </button>
            </div>
          </div>
        </div>
      )}

      {promptState && (
        <div className="modal-mask" onClick={() => { promptState.resolve(null); setPromptState(null); }}>
          <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
            <h3>{promptState.title}</h3>
            {promptState.message && <p className="modal-text">{promptState.message}</p>}
            <input
              className="modal-input"
              type={promptState.inputType || "text"}
              autoFocus
              placeholder={promptState.placeholder}
              defaultValue={promptState.defaultValue}
              onChange={(e) => (promptState.value = e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { promptState.resolve(promptState.value); setPromptState(null); }
                if (e.key === "Escape") { promptState.resolve(null); setPromptState(null); }
              }}
            />
            <div className="modal-actions">
              <button onClick={() => { promptState.resolve(null); setPromptState(null); }}>取消</button>
              <button className="btn-primary" onClick={() => { promptState.resolve(promptState.value); setPromptState(null); }}>确定</button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
