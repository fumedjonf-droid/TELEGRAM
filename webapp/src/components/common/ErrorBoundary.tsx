import { Component, ErrorInfo, ReactNode } from "react";

type Props = {
  children: ReactNode;
};

type State = {
  hasError: boolean;
};

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught an error", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="page">
          <div className="empty-state">
            <h2>Что-то пошло не так</h2>
            <p>Попробуйте обновить страницу или вернитесь позже.</p>
            <button className="button primary" onClick={() => window.location.reload()}>
              Обновить
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
