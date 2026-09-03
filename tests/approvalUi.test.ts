import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as ts from 'typescript/unstable/ast';
import {
  closeSourceAst,
  directArrowCall,
  findNodes,
  isIdentifier,
  isJsxElementNamed,
  jsxAttributeExpression,
  jsxStaticAttribute,
  sourceFile,
  unwrapExpression
} from './sourceAst.js';

async function source(path: string): Promise<string> {
  return readFile(new URL(path, import.meta.url), 'utf8');
}

function chatWindowAst(): ts.SourceFile {
  return sourceFile('src/components/ChatWindow.tsx');
}

test.after(closeSourceAst);

function isButton(node: ts.Node): node is ts.JsxElement {
  return isJsxElementNamed(node, 'button');
}

function isStringValue(expression: ts.Expression, value: string): boolean {
  const current = unwrapExpression(expression);
  return (
    (ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current))
    && current.text === value
  );
}

function isApprovalLabel(expression: ts.Expression): boolean {
  const current = unwrapExpression(expression);
  return (
    ts.isConditionalExpression(current)
    && isIdentifier(current.condition, 'approvalMode')
    && isStringValue(current.whenTrue, '关闭人工审批')
    && isStringValue(current.whenFalse, '开启人工审批')
  );
}

test('the compact composer exposes review mode as one pressed tool button', () => {
  const sourceFile = chatWindowAst();
  const approvalButtons = findNodes(sourceFile, isButton).filter((button) => {
    const label = jsxAttributeExpression(button, 'aria-label');
    return Boolean(label && isApprovalLabel(label));
  });
  assert.equal(approvalButtons.length, 1);
  const approvalButton = approvalButtons[0];
  assert.ok(approvalButton);

  const pressed = jsxAttributeExpression(approvalButton, 'aria-pressed');
  const disabled = jsxAttributeExpression(approvalButton, 'disabled');
  const onClick = jsxAttributeExpression(approvalButton, 'onClick');
  assert.ok(pressed && isIdentifier(pressed, 'approvalMode'));
  assert.ok(disabled && isIdentifier(disabled, 'streaming'));
  assert.ok(onClick);
  const toggleCall = directArrowCall(onClick);
  assert.ok(toggleCall && isIdentifier(toggleCall.expression, 'onReviewModeChange'));
  assert.equal(toggleCall.arguments.length, 1);
  const toggledMode = toggleCall.arguments[0];
  assert.ok(toggledMode);
  const toggleOperand = unwrapExpression(toggledMode);
  assert.ok(
    ts.isPrefixUnaryExpression(toggleOperand)
    && toggleOperand.operator === ts.SyntaxKind.ExclamationToken
    && isIdentifier(toggleOperand.operand, 'approvalMode')
  );
  assert.equal(jsxStaticAttribute(approvalButton, 'type'), 'button');
});

test('App keeps automatic review mode as the default', async () => {
  const app = await source('../src/App.tsx');

  assert.match(app, /const \[reviewMode, setReviewMode\] = useState\(false\)/);
  assert.match(app, /reviewMode/);
});

test('chat streaming accepts an explicit review mode and routes approval events', async () => {
  const chat = await source('../src/lib/chat.ts');

  assert.match(chat, /review = false/);
  assert.match(chat, /onApproval\?/);
  assert.match(chat, /review\s*\?\s*\{ review: true \}/);
  assert.match(chat, /event\.type === 'approval'/);
});

test('streamChat sends the review flag only when requested', async () => {
  const { streamChat } = await import('../src/lib/chat.js');
  const originalFetch = globalThis.fetch;
  let requestBody = '';
  globalThis.fetch = async (_url, init) => {
    requestBody = String(init?.body ?? '');
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"type":"done"}\n\n'));
        controller.close();
      }
    });
    return new Response(body, { status: 200 });
  };
  try {
    await streamChat([{ role: 'user', content: '审批' }], new AbortController().signal, {}, undefined, 'text', true);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal((JSON.parse(requestBody) as { review?: boolean }).review, true);
});

test('messages render approval actions and call the approval decision endpoint', async () => {
  const item = await source('../src/components/MessageItem.tsx');

  assert.match(item, /message\.approval/);
  assert.match(item, /api\/approvals/);
  assert.match(item, /批准/);
  assert.match(item, /拒绝/);
});
