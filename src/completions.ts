/**
 * Deterministic shell-completion scripts for the `openapimcp` CLI.
 *
 * The same command and flag set is emitted for every supported shell so the
 * output only depends on the requested shell name.
 */

const SUBCOMMANDS = ["serve", "list", "doctor", "call", "generate"] as const;

const MAIN_FLAGS = [
  "--help",
  "--version",
  "--include",
  "--exclude",
  "--tag",
  "--read-only",
  "--policy",
  "--base-url",
  "-H",
  "--header",
  "--fields",
  "--max-bytes",
  "--timeout",
  "--retries",
  "--cache-ttl",
  "--paginate",
  "--max-pages",
  "--name",
  "--print-config",
  "--http",
  "--port",
  "--host",
  "--path",
  "--allowed-host",
  "--allowed-origin",
  "--json",
  "--args",
  "--out"
] as const;

export function completionsFor(shell: "bash" | "zsh" | "fish" | "powershell"): string {
  switch (shell) {
    case "bash":
      return bashScript();
    case "zsh":
      return zshScript();
    case "fish":
      return fishScript();
    case "powershell":
      return powershellScript();
    default:
      throw new Error(`unsupported shell: ${String(shell)}`);
  }
}

function bashScript(): string {
  const subcommands = SUBCOMMANDS.join(" ");
  const flags = MAIN_FLAGS.join(" ");
  return [
    "# openapimcp bash completion",
    "# add to ~/.bashrc:  source <(openapimcp completions bash)",
    "_openapimcp() {",
    '  local cur="${COMP_WORDS[COMP_CWORD]}"',
    `  local subcommands="${subcommands}"`,
    `  local flags="${flags}"`,
    "  if [[ ${COMP_CWORD} -eq 1 ]]; then",
    '    COMPREPLY=( $(compgen -W "${subcommands} ${flags}" -- "${cur}") )',
    "    return 0",
    "  fi",
    '  case "${COMP_WORDS[1]}" in',
    "    serve|list)",
    '      COMPREPLY=( $(compgen -W "${flags}" -- "${cur}") ) ;;',
    "    doctor)",
    '      COMPREPLY=( $(compgen -W "--base-url -H --header --timeout" -- "${cur}") ) ;;',
    "    call)",
    '      COMPREPLY=( $(compgen -W "--args ${flags}" -- "${cur}") ) ;;',
    "    generate)",
    '      COMPREPLY=( $(compgen -W "--out --name ${flags}" -- "${cur}") ) ;;',
    "    *)",
    '      COMPREPLY=( $(compgen -W "${subcommands} ${flags}" -- "${cur}") ) ;;',
    "  esac",
    "}",
    "complete -F _openapimcp openapimcp",
    ""
  ].join("\n");
}

function zshScript(): string {
  const subcommands = SUBCOMMANDS.map((name) => `'${name}'`).join(" ");
  const flags = MAIN_FLAGS.map((name) => `'${name}'`).join(" ");
  return [
    "#compdef openapimcp",
    "# openapimcp zsh completion",
    "# add to ~/.zshrc:  source <(openapimcp completions zsh)",
    "_openapimcp() {",
    "  local -a subcommands flags",
    `  subcommands=(${subcommands})`,
    `  flags=(${flags})`,
    "  if (( CURRENT == 2 )); then",
    "    _describe 'command' subcommands",
    "    _describe 'flag' flags",
    "    return",
    "  fi",
    '  case "${words[2]}" in',
    "    serve|list) _values 'flag' $flags ;;",
    "    doctor) _values 'flag' --base-url -H --header --timeout ;;",
    "    call) _values 'flag' --args $flags ;;",
    "    generate) _values 'flag' --out --name $flags ;;",
    "    *) _values 'flag' $flags ;;",
    "  esac",
    "}",
    "compdef _openapimcp openapimcp",
    ""
  ].join("\n");
}

function fishScript(): string {
  const lines = ["# openapimcp fish completion", "complete -c openapimcp -f"];
  for (const name of SUBCOMMANDS) {
    lines.push(`complete -c openapimcp -n '__fish_use_subcommand' -a '${name}' -d 'openapimcp ${name}'`);
  }
  for (const flag of MAIN_FLAGS) {
    if (flag.startsWith("--")) {
      lines.push(`complete -c openapimcp -l '${flag.slice(2)}'`);
    } else if (/^-[^-]/.test(flag)) {
      lines.push(`complete -c openapimcp -s '${flag.slice(1)}'`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

function powershellScript(): string {
  const subcommands = SUBCOMMANDS.map((name) => `'${name}'`).join(", ");
  const flags = MAIN_FLAGS.map((name) => `'${name}'`).join(", ");
  return [
    "# openapimcp PowerShell completion",
    "# add to $PROFILE:  openapimcp completions powershell | Out-String | Invoke-Expression",
    "Register-ArgumentCompleter -Native -CommandName openapimcp -ScriptBlock {",
    "  param($wordToComplete, $commandAst, $cursorPosition)",
    `  $subcommands = @(${subcommands})`,
    `  $flags = @(${flags})`,
    "  $elements = $commandAst.CommandElements",
    "  $candidates = if ($elements.Count -le 1) { $subcommands + $flags } else { $flags }",
    '  $candidates | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {',
    "    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)",
    "  }",
    "}",
    ""
  ].join("\n");
}
