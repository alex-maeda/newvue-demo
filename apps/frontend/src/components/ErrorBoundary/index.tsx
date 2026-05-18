import React from 'react';
import { Props, State } from './types';

class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);

    this.state = {
      hasError: false,
      stack: undefined,
      message: undefined,
      status: undefined,
    };
  }

  private promiseRejectionHandler = (event: PromiseRejectionEvent) => {
    this.setState({
      hasError: true,
      stack: undefined,
      message: event.reason,
      status: event.reason?.status,
    });
  };

  public static getDerivedStateFromError(
    error: Error & { status?: number },
  ): State {
    return {
      hasError: true,
      stack: error.stack,
      message: error.message,
      status: error.status,
    };
  }

  componentDidMount(): void {
    window.addEventListener('unhandledrejection', this.promiseRejectionHandler);
  }

  componentWillUnmount(): void {
    window.removeEventListener(
      'unhandledrejection',
      this.promiseRejectionHandler,
    );
  }

  public render(): React.ReactNode {
    const { message } = this.state;

    if (this.state.hasError) {
      return (
        <div className="wrapper">
          <main className="main">
            <section className="page-section">
              <div className="wrapper wrapper-error-Boundary">
                <h1>Something went wrong</h1>
                <pre>{message}</pre>
              </div>
            </section>
          </main>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
