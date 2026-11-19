import type { ComponentProps, ReactNode } from 'react';

import './mobile-study.css';

function Screen({ children }: { children: ReactNode }) {
  return <main className="mobile-study-screen">{children}</main>;
}

function Header({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="mobile-study-header">
      <h1>{title}</h1>
      {children}
    </header>
  );
}

function Stack({ children }: { children: ReactNode }) {
  return <div className="mobile-study-stack">{children}</div>;
}

function Section({ children }: { children: ReactNode }) {
  return <section className="mobile-study-stack">{children}</section>;
}

function Row({ children }: { children: ReactNode }) {
  return <div className="mobile-study-row">{children}</div>;
}

function Form(props: ComponentProps<'form'>) {
  return <form {...props} className="mobile-study-stack" />;
}

function Code({ children }: { children: ReactNode }) {
  return <strong className="mobile-study-code">{children}</strong>;
}

function PairingDiagram() {
  return (
    <svg className="mobile-study-diagram" viewBox="0 0 560 196" aria-hidden="true" fill="none">
      <g stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
        <rect x="28" y="27" width="225" height="126" rx="12" className="mobile-study-device" />
        <path d="M28 144h225l17 14q-2 12-16 12H27q-14 0-16-12z" className="mobile-study-device" />
        <path d="M122 153h37" strokeLinecap="round" />
        <rect x="40" y="39" width="201" height="96" rx="6" className="mobile-study-display" />
        <rect x="405" y="17" width="109" height="163" rx="16" className="mobile-study-device" />
        <rect x="414" y="26" width="91" height="145" rx="9" className="mobile-study-display" />
        <path d="M451 33h17m-22 131h27" strokeLinecap="round" />
      </g>

      <g className="mobile-study-diagram-detail" strokeWidth="3" strokeLinecap="round">
        <path d="M115 66h80m-80 15h95m-95 15h67m-67 15h51" />
        <path d="M433 55h30m-30 13h54m-54 13h42m-42 53h54m-54 12h33" />
      </g>
      <path
        className="mobile-study-diagram-accent"
        fill="currentColor"
        fillRule="evenodd"
        d="M58 62h16v16H58zm4 4v8h8v-8zm20-4h16v16H82zm4 4v8h8v-8zM58 86h16v16H58zm4 4v8h8v-8zm20-4h7v7h-7zm9 9h7v7h-7zm-9 2h5v5h-5z"
      />
      <path className="mobile-study-scan" d="M55 60h46" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M271 97h116m-7-6 7 6-7 6"
        className="mobile-study-diagram-detail"
        strokeWidth="2"
        strokeDasharray="4 6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle className="mobile-study-pulse" cx="271" cy="97" r="4" />
      <g className="mobile-study-diagram-accent" stroke="currentColor" strokeWidth="2.5">
        <circle cx="460" cy="106" r="16" className="mobile-study-device" />
        <path d="m453 106 5 5 9-10" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

function PairingGuide({ steps }: { steps: readonly { title: string; description: string }[] }) {
  return (
    <div className="mobile-study-guide">
      <PairingDiagram />
      <ol className="mobile-study-steps">
        {steps.map(({ title, description }) => (
          <li key={title}>
            <strong>{title}</strong>
            <p>{description}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

export const MobileStudy = { Screen, Header, Stack, Section, Row, Form, Code, PairingGuide };
