import { Runtime } from "foldkit";

import { Command } from "./command.ts";
import { Model, initialModel } from "./model.ts";
import { update } from "./update.ts";
import { view } from "./view.ts";
import "./styles.css";

// Boot is separate from the definitions so tests can import model, update and view
// without starting a runtime.
const application = Runtime.makeApplication({
  Model,
  container: document.getElementById("root"),
  init: () => ({ commands: [Command.RestoreSession()], model: initialModel }),
  update,
  view,
});

Runtime.run(application);
