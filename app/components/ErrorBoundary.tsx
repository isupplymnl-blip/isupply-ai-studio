'use client';

import React from 'react';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

/**
 * Wraps canvas node trees so an uncaught error in one node component is isolated
 * and does not crash the entire studio canvas.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] Uncaught error in canvas:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div style={{
          padding: 14,
          background: '#1A0010',
          border: '1px solid #F43F5E44',
          borderRadius: 10,
          color: '#F43F5E',
          fontSize: 11,
          maxWidth: 300,
          margin: 'auto',
        }}>
          <strong>⚠ Canvas Error</strong>
          <p style={{ marginTop: 5, color: 'var(--studio-text-sec)', fontSize: 10, lineHeight: 1.5 }}>
            {this.state.error?.message ?? 'An unexpected error occurred in a canvas node.'}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: undefined })}
            style={{
              marginTop: 8,
              padding: '4px 12px',
              fontSize: 10,
              fontWeight: 600,
              borderRadius: 5,
              background: 'var(--studio-elevated)',
              border: '1px solid #F43F5E44',
              color: '#F43F5E',
              cursor: 'pointer',
            }}
          >
            Dismiss &amp; Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
