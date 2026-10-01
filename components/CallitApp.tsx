'use client';

import { useEffect } from 'react';
import { SHELL_HTML } from '@/lib/legacy/shell';
import { bootCallit } from '@/lib/legacy/engine';

/** Mounts the Callit shell and starts the app engine in the browser. */
export default function CallitApp() {
  useEffect(() => {
    bootCallit();
  }, []);

  return <div id="callit-root" suppressHydrationWarning dangerouslySetInnerHTML={{ __html: SHELL_HTML }} />;
}
