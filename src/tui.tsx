import { Plugin } from "@opencode/plugin/tui";

export default Plugin.define({
  id: "ocswarm.tui",
  setup(context) {
    context.ui.toast.show({ message: "🐝 ocswarm loaded", variant: "success", duration: 3000 });
  },
});
