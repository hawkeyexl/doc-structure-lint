/** Programmatic API for moose-lint. */
export { runLint, STDIN_LABEL } from "./commands/lint.js";
export type {
  LintOptions,
  LintRun,
  LintSummary,
  LintFileResult,
} from "./commands/lint.js";
export { runTemplates, BUILTIN_SOURCE } from "./commands/templates.js";
export type {
  TemplateInfo,
  TemplatesInfo,
  TemplatesOptions,
} from "./commands/templates.js";
export { runFormats } from "./commands/formats.js";
export type { FormatInfo } from "./commands/formats.js";
export { validateDocument, validateSections } from "./core/validator.js";
export { matchSections } from "./core/match.js";
export type { Match, MatchResult } from "./core/match.js";
export { headingMatches, isRequired, isSlot } from "./core/template.js";
export type {
  Template,
  TemplateFile,
  TemplateSection,
} from "./core/template.js";
export {
  listBuiltins,
  loadTemplate,
  loadTemplateFile,
  resolveExtends,
  classifyRef,
} from "./core/template-registry.js";
export type {
  BuiltinInfo,
  LoadTemplateOptions,
  RefKind,
  TemplateResolver,
} from "./core/template-registry.js";
export { resolveTargets, STDIN_TOKEN } from "./core/load-files.js";
export type { ResolveOptions } from "./core/load-files.js";
export {
  listFormats,
  parserByName,
  parserForExtension,
  supportedExtensions,
} from "./parsers/index.js";
export {
  render,
  renderPretty,
  renderJson,
  renderGithub,
  renderTemplates,
  renderFormats,
} from "./reporters/index.js";
export type {
  ReportFormat,
  ReportOptions,
  ListFormat,
} from "./reporters/index.js";
export { palette, shouldColor } from "./reporters/color.js";
export * from "./types.js";
