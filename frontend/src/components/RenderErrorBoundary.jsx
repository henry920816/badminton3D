import React from 'react';

// 元件出錯時顯示錯誤訊息，其他頁面仍能操作。
export default class RenderErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      error: null
    };
  }
  static getDerivedStateFromError(error) {
    return {
      error
    };
  }
  componentDidCatch(error, details) {
    console.error('badminton3D interface render error:', error, details);
  }
  render() {
    if (!this.state.error) return this.props.children;
    const message = String(this.state.error?.message || this.state.error);
    return <section className="flex h-full min-h-[240px] w-full flex-col items-start justify-center gap-4 overflow-auto bg-zinc-950 p-6 text-zinc-200">
        <h2 className="text-lg font-semibold text-rose-300">介面載入失敗</h2>
        <p className="max-w-2xl text-sm text-zinc-400">此區塊發生錯誤，其他頁面應仍可使用。請查看下方錯誤並確認安裝的程式版本一致。</p>
        <pre className="max-h-52 w-full max-w-2xl overflow-auto whitespace-pre-wrap break-words rounded border border-rose-900/50 bg-zinc-900 p-3 text-xs text-rose-200">{message}</pre>
        <div className="flex flex-wrap gap-3">
          {typeof this.props.onRecover === 'function' && <button type="button" onClick={this.props.onRecover} className="rounded bg-zinc-700 px-4 py-2 text-sm hover:bg-zinc-600">返回 Timeline</button>}
          <button type="button" onClick={() => window.location.reload()} className="rounded border border-zinc-600 px-4 py-2 text-sm hover:bg-zinc-800">重新載入</button>
        </div>
      </section>;
  }
}
