'use client';

import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from '@/components/ai-elements/tool';
import { ComputerScreenshotOutput } from '@/components/computer-screenshot-output';
import type { ScreenshotReference } from '@/lib/computer-use/screenshot-contract';
import type { ComponentProps } from 'react';

type ComputerScreenshotToolProps = {
  state: ComponentProps<typeof ToolHeader>['state'];
  input?: ComponentProps<typeof ToolInput>['input'];
  output?: ComponentProps<typeof ToolOutput>['output'];
  errorText?: ComponentProps<typeof ToolOutput>['errorText'];
  screenshots?: ScreenshotReference[];
};

/** Renders a screenshot capture inline after success, and as a Tool row otherwise. */
export function ComputerScreenshotTool({
  errorText,
  input,
  output,
  screenshots,
  state,
}: ComputerScreenshotToolProps) {
  if (screenshots?.length) {
    return <ComputerScreenshotOutput screenshots={screenshots} />;
  }

  return (
    <Tool defaultOpen={false}>
      <ToolHeader
        title="computer_screenshot"
        type="tool-computer_screenshot"
        state={state}
      />
      <ToolContent>
        {input !== undefined && <ToolInput input={input} />}
        <ToolOutput output={output} errorText={errorText} />
      </ToolContent>
    </Tool>
  );
}
