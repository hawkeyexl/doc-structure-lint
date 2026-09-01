/**
 * `templates` command core. Reports the templates a run could resolve: the
 * built-ins, plus the named templates in any files given by `--templates` or by
 * `lint.templates` in the config, with the doctypes each serves.
 *
 * The `types` column is the part worth printing. It is what frontmatter
 * routing will match a page against, so seeing it is how someone works out
 * which `type:` value to write in a page - or that no template claims the one
 * they already wrote.
 *
 * Returns data; `src/reporters/index.ts` renders it.
 */
import {
  listBuiltins,
  loadTemplateFile,
} from "../core/template-registry.js";

/** `TemplateInfo.source` for a template that ships with the tool. */
export const BUILTIN_SOURCE = "builtin";

export interface TemplateInfo {
  /** The ref to pass to `--template`. */
  id: string;
  /**
   * Human-readable title. Empty for templates read from a user file: the
   * template DSL has no title field, only the built-in registry carries one.
   */
  title: string;
  /** Doctypes the template serves, matched against a page `type`. */
  types: string[];
  /** `builtin`, or the template file this entry came from. */
  source: string;
}

export interface TemplatesInfo {
  templates: TemplateInfo[];
}

export interface TemplatesOptions {
  /** Template files whose entries join the built-ins. */
  templates?: string | string[];
}

export async function runTemplates(
  opts: TemplatesOptions = {},
): Promise<TemplatesInfo> {
  const templates: TemplateInfo[] = listBuiltins().map((builtin) => ({
    id: builtin.id,
    title: builtin.title,
    types: builtin.types,
    source: BUILTIN_SOURCE,
  }));

  // Listed after the built-ins, in the order supplied - the same order
  // `buildTypeIndex` applies them in, so a later entry claiming the same
  // doctype is the one that would win.
  const paths =
    opts.templates == null
      ? []
      : Array.isArray(opts.templates)
        ? opts.templates
        : [opts.templates];

  for (const path of paths) {
    const file = await loadTemplateFile(path);
    for (const [id, template] of Object.entries(file.templates ?? {})) {
      templates.push({
        id,
        title: "",
        types: template.types ?? [],
        source: path,
      });
    }
  }

  return { templates };
}
