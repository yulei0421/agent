import assert from 'node:assert/strict';
import test from 'node:test';
import * as ts from 'typescript/unstable/ast';
import {
  balancedBlock,
  closeSourceAst,
  directArrowCall,
  findNodes,
  hasJsxAncestorWithStaticClassToken,
  hasStaticClassToken,
  isJsxElementNamed,
  sourceFile,
  staticClassTokens,
  topLevelLogicalOrOperands
} from './sourceAst.js';

test.after(closeSourceAst);

function variableInitializer(file: ts.SourceFile, name: string): ts.Expression {
  const declaration = findNodes(file, ts.isVariableDeclaration).find(
    (candidate) => ts.isIdentifier(candidate.name) && candidate.name.text === name
  );
  assert.ok(declaration?.initializer, `expected initializer for ${name}`);
  return declaration.initializer;
}

test('directArrowCall rejects calls hidden in nested uncalled functions', () => {
  const fixture = sourceFile('tests/fixtures/sourceAst.fixture.tsx');

  assert.ok(directArrowCall(variableInitializer(fixture, 'directStop')));
  assert.equal(directArrowCall(variableInitializer(fixture, 'nestedStop')), undefined);
});

test('toolbar descendant searches exclude JSX outside the toolbar and accept extra class tokens', () => {
  const fixture = sourceFile('tests/fixtures/sourceAst.fixture.tsx');
  const toolbar = findNodes(fixture, ts.isJsxElement).find(
    (element) => hasStaticClassToken(element, 'composer-toolbar')
  );
  assert.ok(toolbar);
  assert.deepEqual(staticClassTokens(toolbar), ['composer-toolbar', 'compact']);

  const allButtons = findNodes(fixture, (node): node is ts.JsxElement => isJsxElementNamed(node, 'button'));
  const toolbarButtons = findNodes(toolbar, (node): node is ts.JsxElement => isJsxElementNamed(node, 'button'));
  assert.equal(allButtons.length, 3);
  assert.equal(toolbarButtons.length, 2);
  assert.ok(allButtons.some((button) => !toolbarButtons.includes(button)));
  assert.ok(toolbarButtons.every((button) => hasJsxAncestorWithStaticClassToken(button, 'composer-toolbar')));
  assert.ok(allButtons.some((button) => !hasJsxAncestorWithStaticClassToken(button, 'composer-toolbar')));
});

test('topLevelLogicalOrOperands rejects logical AND', () => {
  const fixture = sourceFile('tests/fixtures/sourceAst.fixture.tsx');

  assert.equal(topLevelLogicalOrOperands(variableInitializer(fixture, 'logicalAnd')), undefined);
  assert.ok(topLevelLogicalOrOperands(variableInitializer(fixture, 'logicalOr')));
});

test('balancedBlock returns one complete nested media block', () => {
  const css = [
    '@media (max-width: 420px) {',
    '  .composer-toolbar { gap: 4px; }',
    '}',
    '@media (max-width: 520px) {',
    '  .composer-actions { display: grid; }',
    '}'
  ].join('\n');

  const narrow = balancedBlock(css, '@media (max-width: 420px)');
  assert.match(narrow, /\.composer-toolbar/);
  assert.doesNotMatch(narrow, /\.composer-actions/);
  assert.doesNotMatch(narrow, /max-width: 520px/);
});
