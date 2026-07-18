export interface ToolDiscoveryOverride {
  aliases: readonly string[];
  tags: readonly string[];
  summary?: string;
}

export const RUN_MACRO_SCRIPT_EFFECTIVE_DESCRIPTION =
  "Replay a `MacroRecord` through same-session active safe handlers; raw-code and destructive targets are always blocked, and the legacy `allowRawPython` field is accepted only for input-schema compatibility.";

export const TOOL_DISCOVERY_OVERRIDES: Readonly<Record<string, ToolDiscoveryOverride>> = {
  get_td_info: {
    aliases: ["TouchDesigner 상태", "연결 상태", "bridge health"],
    tags: ["inspect", "connection"],
  },
  find_td_nodes: {
    aliases: ["노드 찾기", "노드 검색", "find nodes"],
    tags: ["inspect", "topology"],
  },
  get_td_node_parameters: {
    aliases: ["노드 파라미터", "parameter inspect"],
    tags: ["inspect", "parameter"],
  },
  get_preview: {
    aliases: ["미리보기", "렌더 미리보기", "preview image"],
    tags: ["inspect", "render"],
  },
  create_audio_reactive: {
    aliases: ["오디오 반응형", "사운드 리액티브", "audio reactive visual"],
    tags: ["audio", "build"],
  },
  create_glsl_shader: {
    aliases: ["GLSL 셰이더", "셰이더 만들기", "build shader"],
    tags: ["glsl", "shader", "build"],
  },
  list_recipes: {
    aliases: ["레시피 목록", "recipe list"],
    tags: ["recipe", "library"],
  },
  apply_recipe: {
    aliases: ["레시피 적용", "apply recipe"],
    tags: ["recipe", "build"],
  },
  arrange_network: {
    aliases: ["노드 정리", "그래프 정리", "layout nodes"],
    tags: ["layout", "build"],
  },
  show_preflight_report: {
    aliases: ["공연 전 점검", "리허설 점검", "show rehearsal"],
    tags: ["show", "preflight"],
  },
  browse_library: {
    aliases: ["라이브러리 검색", "컴포넌트 찾기", "browse library"],
    tags: ["library", "search"],
  },
  diff_library_assets: {
    aliases: ["라이브러리 비교", "asset diff"],
    tags: ["library", "diff"],
  },
  connect_nodes: {
    aliases: ["노드 연결", "connect operators"],
    tags: ["build", "topology"],
  },
  update_td_node_parameters: {
    aliases: ["파라미터 수정", "set parameters"],
    tags: ["build", "parameter"],
  },
  summarize_td_errors: {
    aliases: ["오류 요약", "에러 정리"],
    tags: ["inspect", "error"],
  },
  create_particle_system: {
    aliases: ["파티클 시스템", "particle visual"],
    tags: ["particle", "build"],
  },
  create_feedback_network: {
    aliases: ["피드백 네트워크", "feedback visual"],
    tags: ["feedback", "build"],
  },
  create_projection_mapping: {
    aliases: ["프로젝션 매핑", "projection mapping"],
    tags: ["mapping", "build"],
  },
  create_color_grade: {
    aliases: ["컬러 그레이딩", "color grading"],
    tags: ["color", "build"],
  },
  create_setlist_runner: {
    aliases: ["셋리스트 실행", "setlist runner"],
    tags: ["show", "cue"],
  },
  import_shadertoy: {
    aliases: ["Shadertoy 가져오기", "import shadertoy"],
    tags: ["shader", "import"],
  },
  create_pose_tracking: {
    aliases: ["포즈 트래킹", "body pose tracking"],
    tags: ["tracking", "build"],
  },
  setup_output: {
    aliases: ["출력 설정", "output mapping"],
    tags: ["output", "show"],
  },
  search_python_api: {
    aliases: ["파이썬 API 검색", "python api help"],
    tags: ["inspect", "python"],
  },
  execute_python_script: {
    aliases: ["파이썬 실행", "raw python"],
    tags: ["python", "raw-code"],
  },
  run_macro_script: {
    aliases: [],
    tags: [],
    summary: RUN_MACRO_SCRIPT_EFFECTIVE_DESCRIPTION,
  },
};

export function effectiveToolDescription(
  name: string,
  fallback: string | undefined,
): string | undefined {
  const override = Object.hasOwn(TOOL_DISCOVERY_OVERRIDES, name)
    ? TOOL_DISCOVERY_OVERRIDES[name]
    : undefined;
  return override?.summary ?? fallback;
}
