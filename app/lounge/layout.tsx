import { ReactNode } from 'react';

export default function LoungeLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <>
      <style dangerouslySetInnerHTML={{
        __html: `
          html {
            background-color: #020617 !important;
          }
          body {
            background-color: #020617 !important;
          }
        `
      }} />
      {children}
    </>
  );
}

