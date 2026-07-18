import type { ToolProfile } from "../../utils/config.js";

export const DYNAMIC_MANAGEMENT_TOOL_NAMES = [
  "discover_tools",
  "select_toolset",
  "get_active_toolset",
  "reset_toolset",
] as const;

export const DYNAMIC_MANAGEMENT_TOOL_NAME_SET: ReadonlySet<string> = new Set(
  DYNAMIC_MANAGEMENT_TOOL_NAMES,
);

/** Every existing tool whose MCP annotation declares `destructiveHint: true`. */
export const SAFE_PROFILE_EXCLUDE: ReadonlySet<string> = new Set([
  "execute_python_script",
  "exec_node_method",
  "create_python_script",
  "author_script_operator",
  "delete_td_node",
  "rebuild_network",
  "edit_dat_content",
  "set_dat_content",
  "edit_shader_live_loop",
  "create_panic",
  "manage_checkpoint",
  "manage_component",
  "manage_packages",
  "make_portable_tox",
  "export_recipe_bundle",
  "optimize_performance",
  "publish_recipe_bundle",
  "import_recipe_bundle",
  "scaffold_recipe_template",
  "attach_docs_as_assets",
  "local_marketplace_index",
  "marketplace_index_seed",
  "refresh_asset_previews",
  "install_library_package",
  "create_modulators",
  "project_documentation_site",
  "import_recipe_from_url",
  "export_palette_component",
  "collect_project_assets",
  "bundle_dependencies",
  "export_externalized_tree",
  "repair_network",
  "swap_operator",
  "export_sop_to_svg",
  "generative_classics_pack",
  "create_safety_blackout_chain",
  "merge_vaults",
  "manage_component_storage",
  "macro_recorder",
]);

export const DIRECTORY_PROFILE_TOOL_NAMES = [
  "get_td_info",
  "search_operators",
  "get_td_classes",
  "get_operator_workflow_guide",
  "find_td_nodes",
  "get_td_node_parameters",
  "get_td_node_flags",
  "get_td_topology",
  "create_td_node",
  "connect_nodes",
  "update_td_node_parameters",
  "validate_operator_chain",
  "list_recipes",
  "apply_recipe",
  "browse_library",
] as const;

export const RAW_CODE_TOOL_NAMES = [
  "execute_python_script",
  "exec_node_method",
  "create_python_script",
  "author_script_operator",
] as const;

// Task 5 replaces the five temporary aliases with their explicit curated lists.
const STATIC_PROFILE_TOOL_NAMES: Record<
  Exclude<ToolProfile, "full" | "safe">,
  readonly string[]
> = {
  directory: DIRECTORY_PROFILE_TOOL_NAMES,
  core: DIRECTORY_PROFILE_TOOL_NAMES,
  inspect: DIRECTORY_PROFILE_TOOL_NAMES,
  build: DIRECTORY_PROFILE_TOOL_NAMES,
  show: DIRECTORY_PROFILE_TOOL_NAMES,
  library: DIRECTORY_PROFILE_TOOL_NAMES,
};

export function staticProfileAllows(name: string, profile: ToolProfile): boolean {
  if (profile === "full") return true;
  if (profile === "safe") return !SAFE_PROFILE_EXCLUDE.has(name);
  return STATIC_PROFILE_TOOL_NAMES[profile].includes(name);
}
