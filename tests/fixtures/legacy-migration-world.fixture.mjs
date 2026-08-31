export default [
  {
    "name@program": "迁移验收窗口",
    "detail": "LEGACY_AGENT_SITUATION = \"正文中的 name/detail/children/partners 不得被替换\"\nagent({\"labels\":[],\"functions\":{\"groups\":[],\"names\":[\"explore\",\"transform\"]}})",
    "children": [
      {
        "name": "旧关系源",
        "detail": "保持业务事实",
        "children": [],
        "partners": [
          {
            "verb": "依据",
            "object": "迁移验收窗口"
          }
        ]
      }
    ],
    "partners": []
  }
];
