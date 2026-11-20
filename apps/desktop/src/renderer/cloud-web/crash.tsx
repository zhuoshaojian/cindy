import { Component, type ReactNode } from 'react';
import { AppCrashScreen } from '../components/error/AppCrashScreen';
import { crashReport } from './startFailure';

/** A render error shows the client's crash screen with the report instead of a blank page. */
export class CloudWebErrorBoundary extends Component<
  { children: ReactNode },
  { report: ReturnType<typeof crashReport> | null }
> {
  state: { report: ReturnType<typeof crashReport> | null } = { report: null };

  static getDerivedStateFromError(error: unknown) {
    return { report: crashReport(error) };
  }

  render(): ReactNode {
    const { report } = this.state;
    if (!report) return this.props.children;
    return <AppCrashScreen variant="fullscreen" message={report.message} stack={report.details} />;
  }
}
