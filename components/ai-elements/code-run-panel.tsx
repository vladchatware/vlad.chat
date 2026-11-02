'use client';

import { CodeBlock, CodeBlockCopyButton } from '@/components/ai-elements/code-block';
import {
  Sandbox,
  SandboxContent,
  SandboxHeader,
  SandboxTabContent,
  SandboxTabs,
  SandboxTabsBar,
  SandboxTabsList,
  SandboxTabsTrigger,
} from '@/components/ai-elements/sandbox';

export type CodeRunView = {
  code: string;
  description: string;
  status: 'running' | 'completed' | 'failed' | 'stopped' | 'interrupted';
  stdout: string;
  stderr: string;
  outputTruncated: boolean;
  returnValue?: string;
  errorText?: string;
};

function formatReturnValue(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2) ?? value;
  } catch {
    return value;
  }
}

function persistedOutputFields(value: string): {
  stdout?: string;
  stderr?: string;
  returnValue?: string;
  details: string[];
} {
  const result: {
    stdout?: string;
    stderr?: string;
    returnValue?: string;
    details: string[];
  } = { details: [] };

  for (const section of value.split('\n\n')) {
    if (/^(?:Program:|Run ID:|Status:|Exit code:)/.test(section)) continue;
    if (section.startsWith('stdout:\n')) {
      result.stdout = section.slice('stdout:\n'.length);
    } else if (section.startsWith('stderr:\n')) {
      result.stderr = section.slice('stderr:\n'.length);
    } else if (section.startsWith('Return value: ')) {
      result.returnValue = section.slice('Return value: '.length);
    } else if (section) {
      result.details.push(section);
    }
  }

  return result;
}

export function CodeRunPanel({ code, description, run, fallbackStatus, persistedOutput, errorText }: {
  code: string;
  description: string;
  run?: CodeRunView;
  fallbackStatus: CodeRunView['status'];
  persistedOutput?: string;
  errorText?: string;
}) {
  const status = run?.status ?? fallbackStatus;
  const persisted = persistedOutput ? persistedOutputFields(persistedOutput) : undefined;
  const stdout = run?.stdout || persisted?.stdout;
  const stderr = run?.stderr || persisted?.stderr;
  const returnValue = run?.returnValue ?? persisted?.returnValue;
  const returnValueIsJson = returnValue !== undefined && (() => {
    try {
      JSON.parse(returnValue);
      return true;
    } catch {
      return false;
    }
  })();
  const details = [
    ...(!run ? persisted?.details ?? [] : []),
    run?.errorText ?? errorText,
    run?.outputTruncated ? 'Output truncated at 64 KiB.' : undefined,
  ].filter((detail): detail is string => Boolean(detail));
  const hasOutput = Boolean(stdout || stderr || returnValue || details.length);
  const sandboxState = status === 'running'
    ? 'input-available'
    : status === 'completed'
      ? 'output-available'
      : status === 'failed'
        ? 'output-error'
        : 'output-available';
  const statusLabel = status === 'stopped' || status === 'interrupted'
    ? status[0].toUpperCase() + status.slice(1)
    : undefined;

  return (
    <Sandbox className="border-0 rounded-none" defaultOpen>
      <SandboxHeader state={sandboxState} statusLabel={statusLabel} title={description} />
      <SandboxContent>
        <SandboxTabs defaultValue="code">
          <SandboxTabsBar>
            <SandboxTabsList aria-label="Code run details">
              <SandboxTabsTrigger value="code">Code</SandboxTabsTrigger>
              <SandboxTabsTrigger value="output">Output</SandboxTabsTrigger>
            </SandboxTabsList>
          </SandboxTabsBar>
          <SandboxTabContent value="code">
            <CodeBlock code={code} language="typescript" className="max-h-96 overflow-auto">
              <CodeBlockCopyButton aria-label="Copy TypeScript" />
            </CodeBlock>
          </SandboxTabContent>
          <SandboxTabContent value="output" className="max-h-96 min-h-24 space-y-3 overflow-auto" aria-live="polite">
            {stdout && <OutputText title="stdout" value={stdout} />}
            {stderr && <OutputText title="stderr" value={stderr} />}
            {returnValue !== undefined && (returnValueIsJson ? (
              <CodeBlock code={formatReturnValue(returnValue)} language="json" />
            ) : (
              <OutputText title="" value={returnValue} />
            ))}
            {details.map((detail, index) => (
              <OutputText key={`${index}-${detail}`} title="" value={detail} />
            ))}
            {!hasOutput && (
              <p className="p-1 font-mono text-xs text-muted-foreground">
                {status === 'running' ? 'Waiting for output…' : 'No output.'}
              </p>
            )}
          </SandboxTabContent>
        </SandboxTabs>
      </SandboxContent>
    </Sandbox>
  );
}

function OutputText({ title, value }: { title: string; value: string }) {
  return (
    <div className="space-y-1">
      {title && <p className="text-xs font-medium text-muted-foreground">{title}</p>}
      <pre className="whitespace-pre-wrap p-1 font-mono text-xs">{value}</pre>
    </div>
  );
}
