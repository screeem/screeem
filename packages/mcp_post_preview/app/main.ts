import { App } from "@modelcontextprotocol/ext-apps";
import { mount } from "svelte";
import Root from "./App.svelte";

const app = new App({ name: "Post Preview", version: "0.0.1" });
await app.connect();

mount(Root, {
  target: document.getElementById("root")!,
  props: { app },
});
