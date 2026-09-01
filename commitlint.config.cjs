module.exports = {
  extends: ["@commitlint/config-conventional"],
  // semantic-release's `chore(release): ...` commit embeds the full changelog
  // (PR links, compare URLs) and routinely exceeds the default body/footer
  // line-length rules, so skip linting it.
  ignores: [(message) => /^chore\(release\): /.test(message)],
};
