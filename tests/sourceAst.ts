import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript/unstable/ast';
import { API, type Snapshot } from 'typescript/unstable/sync';

export type JsxElementLike = ts.JsxElement | ts.JsxSelfClosingElement;

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const tsconfigPath = resolve(projectRoot, 'tsconfig.json');
let astApi: API | undefined;
let astSnapshot: Snapshot | undefined;
const openFiles = new Set<string>();

export function sourceFile(relativePath: string): ts.SourceFile {
  const filePath = resolve(projectRoot, relativePath);
  astApi ??= new API({ cwd: projectRoot });
  if (!astSnapshot || !openFiles.has(filePath)) {
    const previousSnapshot = astSnapshot;
    astSnapshot = astApi.updateSnapshot({
      ...(!previousSnapshot ? { openProjects: [tsconfigPath] } : {}),
      ...(!openFiles.has(filePath) ? { openFiles: [filePath] } : {})
    });
    previousSnapshot?.dispose();
    openFiles.add(filePath);
  }

  const project = astSnapshot.getDefaultProjectForFile(filePath)
    ?? astSnapshot.getProject(tsconfigPath)
    ?? astSnapshot.getProjects()[0];
  assert.ok(project, `expected a TypeScript project for ${relativePath}`);
  const file = project.program.getSourceFile(filePath);
  assert.ok(file, `expected ${relativePath} in the TypeScript project`);
  return file;
}

export function closeSourceAst(): void {
  astSnapshot?.dispose();
  astApi?.close();
  astSnapshot = undefined;
  astApi = undefined;
  openFiles.clear();
}

export function findNodes<T extends ts.Node>(
  root: ts.Node,
  predicate: (node: ts.Node) => node is T
): T[] {
  const matches: T[] = [];
  const visit = (node: ts.Node): void => {
    if (predicate(node)) matches.push(node);
    node.forEachChild(visit);
  };
  visit(root);
  return matches;
}

export function unwrapExpression(expression: ts.Expression): ts.Expression {
  return ts.skipOuterExpressions(expression);
}

export function isIdentifier(expression: ts.Expression, name: string): boolean {
  const current = unwrapExpression(expression);
  return ts.isIdentifier(current) && current.text === name;
}

function openingElement(element: JsxElementLike): ts.JsxOpeningLikeElement {
  return ts.isJsxElement(element) ? element.openingElement : element;
}

export function jsxAttribute(element: JsxElementLike, name: string): ts.JsxAttribute | undefined {
  return openingElement(element).attributes.properties.find(
    (property): property is ts.JsxAttribute => (
      ts.isJsxAttribute(property)
      && ts.isIdentifier(property.name)
      && property.name.text === name
    )
  );
}

export function jsxAttributeExpression(element: JsxElementLike, name: string): ts.Expression | undefined {
  const initializer = jsxAttribute(element, name)?.initializer;
  return initializer && ts.isJsxExpression(initializer) && initializer.expression
    ? initializer.expression
    : undefined;
}

export function jsxStaticAttribute(element: JsxElementLike, name: string): string | undefined {
  const initializer = jsxAttribute(element, name)?.initializer;
  if (!initializer) return undefined;
  if (ts.isStringLiteral(initializer)) return initializer.text;
  if (ts.isJsxExpression(initializer) && initializer.expression) {
    const expression = unwrapExpression(initializer.expression);
    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return expression.text;
  }
  return undefined;
}

export function staticClassTokens(element: JsxElementLike): string[] {
  return jsxStaticAttribute(element, 'className')?.trim().split(/\s+/u).filter(Boolean) ?? [];
}

export function hasStaticClassToken(element: JsxElementLike, token: string): boolean {
  return staticClassTokens(element).includes(token);
}

export function hasJsxAncestorWithStaticClassToken(node: ts.Node, token: string): boolean {
  let current = node.parent;
  while (current) {
    if (
      (ts.isJsxElement(current) || ts.isJsxSelfClosingElement(current))
      && hasStaticClassToken(current, token)
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

export function isJsxElementNamed(node: ts.Node, name: string): node is ts.JsxElement {
  return (
    ts.isJsxElement(node)
    && ts.isIdentifier(node.openingElement.tagName)
    && node.openingElement.tagName.text === name
  );
}

export function directArrowCall(expression: ts.Expression): ts.CallExpression | undefined {
  const current = unwrapExpression(expression);
  if (!ts.isArrowFunction(current) || ts.isBlock(current.body)) return undefined;
  const body = unwrapExpression(current.body);
  return ts.isCallExpression(body) ? body : undefined;
}

export function topLevelLogicalOrOperands(
  expression: ts.Expression
): readonly [ts.Expression, ts.Expression] | undefined {
  const current = unwrapExpression(expression);
  return (
    ts.isBinaryExpression(current)
    && current.operatorToken.kind === ts.SyntaxKind.BarBarToken
  )
    ? [current.left, current.right]
    : undefined;
}

export function balancedBlock(source: string, marker: string): string {
  const markerStart = source.indexOf(marker);
  const blockStart = markerStart >= 0 ? source.indexOf('{', markerStart + marker.length) : -1;
  if (blockStart < 0) return '';

  let depth = 0;
  let quote: '"' | "'" | null = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = blockStart; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (character === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '/' && next === '/') {
      lineComment = true;
      index += 1;
    } else if (character === '/' && next === '*') {
      blockComment = true;
      index += 1;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(markerStart, index + 1);
    }
  }

  return '';
}
