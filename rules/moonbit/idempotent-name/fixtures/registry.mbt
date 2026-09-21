///|
/// The plugin registry a host process keeps while it boots.
pub(all) struct Plugin {
  name : String
  version : String
}

///|
pub(all) struct Hook {
  event : String
  run : (String) -> Unit
}

///|
pub(all) struct Metrics {
  mut plugins_seen : Int
  mut boots : Int
}

///|
pub(all) struct Defaults {
  mut verbose : Bool
  mut retries : Int
  mut timeout_ms : Int
  mut stages : Array[String]
}

///|
let plugins : Map[String, Plugin] = Map::new()

///|
let hooks : Array[Hook] = []

///|
let tags : Map[String, Array[String]] = Map::new()

///|
let themes : Map[String, String] = Map::new()

///|
let runs : Map[String, String] = Map::new()

///|
let load_order : Array[String] = []

///|
let metrics : Metrics = { plugins_seen: 0, boots: 0 }

///|
let defaults : Defaults = {
  verbose: true,
  retries: 0,
  timeout_ms: 0,
  stages: [],
}

///|
pub fn init_registry() -> Unit {
  load_order.push("core")
  plugins.set("core", { name: "core", version: "1.0.0" })
}

///|
pub fn register_hook(event : String, run : (String) -> Unit) -> Unit {
  hooks.push({ event, run })
}

///|
pub fn register_plugin(name : String, version : String) -> Unit {
  plugins.set(name, { name, version })
}

///|
pub fn register_boot(name : String) -> Unit {
  if not(plugins.contains(name)) {
    metrics.boots = metrics.boots + 1
  }
  plugins.set(name, { name, version: "unknown" })
}

///|
pub fn register_tag(tag : String, name : String) -> Unit {
  let current = match tags.get(tag) {
    Some(existing) => existing
    None => []
  }
  current.push(name)
  tags.set(tag, current)
}

///|
pub fn ensure_metric_slot(name : String, run : (String) -> Unit) -> Unit {
  if load_order.contains(name) {
    return
  }
  hooks.push({ event: name, run })
}

///|
pub fn register_run(name : String) -> Unit {
  let id = runs.length()
  runs.set(id.to_string(), name)
}

///|
pub fn upsert_hook(event : String, run : (String) -> Unit) -> Unit {
  for i in 0..<hooks.length() {
    if hooks[i].event == event {
      hooks[i] = { event, run }
      return
    }
  }
  hooks.push({ event, run })
}

///|
pub fn install_index(name : String) -> Unit {
  if tags.contains(name) {
    return
  }
  tags.set(name, [])
}

///|
pub fn install_plugin(name : String, version : String) -> Unit {
  if plugins.contains(name) {
    abort("plugin already installed: " + name)
  }
  plugins.set(name, { name, version })
}

///|
pub fn install_theme(name : String, body : String) -> Unit {
  if name == "" {
    abort("a theme needs a name")
  }
  themes.set(name, body)
}

///|
pub fn upsert_theme(name : String, body : String) -> Unit {
  if name == "" {
    return
  }
  themes.set(name, body)
}

///|
pub fn install_dependencies(names : Array[String]) -> Unit {
  for name in names {
    ensure_plugin_slot(name)
  }
}

///|
pub fn ensure_plugin_slot(name : String) -> Unit {
  if load_order.contains(name) {
    return
  }
  load_order.push(name)
}

///|
pub fn setup_defaults(retries : Int, timeout_ms : Int) -> Unit {
  defaults.verbose = false
  defaults.retries = retries
  defaults.timeout_ms = timeout_ms
}

///|
pub fn setup_stages(names : Array[String]) -> Unit {
  let built = []
  for name in names {
    built.push("stage:" + name)
  }
  defaults.stages = built
}

///|
pub fn setup_retry_budget(attempts : Int) -> Unit {
  defaults.retries = attempts + 1
  defaults.timeout_ms = attempts * 250
}

///|
pub fn setup_metrics() -> Unit {
  metrics.boots = metrics.boots + 1
  metrics.plugins_seen = plugins.length()
}

///|
pub fn register_login(name : String) -> Unit {
  if name != "" {
    metrics.boots = metrics.boots + 1
  }
  plugins.set(name, { name, version: "unknown" })
}

///|
pub fn ensure_version(plugin : Plugin) -> String {
  if plugin.version == "" {
    "0.0.0"
  } else {
    plugin.version
  }
}
