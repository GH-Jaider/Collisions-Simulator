import type { Renderer } from "../render/renderer";
import type { World } from "../physics/world";
import type { Panel } from "../ui/panels";

export interface Toggle {
  id: string;
  label: string;
  get(): boolean;
  set(value: boolean): void;
}

/** The slice of the application a lab is allowed to reach. */
export interface LabHost {
  readonly paused: boolean;
  pause(): void;
  resume(): void;
  /** Ask for the experiment to be rebuilt, e.g. after a setup change. */
  rearm(): void;
}

export interface PointerState {
  /** Pointer position in world metres, or null when it is outside. */
  position: import("../physics/vec").Vec2 | null;
  held: import("../physics/body").Body | null;
}

export interface Lab {
  readonly id: string;
  readonly title: string;
  readonly blurb: string;
  /** How many metres of the world fit vertically. Sets the camera scale. */
  readonly worldHeight: number;
  /** Whether bodies can be grabbed and flung with the pointer. */
  readonly interactive: boolean;
  /** Long-form explanation for the "how it works" dialog. */
  readonly about: string;

  /** Build or rebuild the experiment. The world is already sized. */
  setup(world: World, host: LabHost): void;
  /** Runs once per frame after the world has been stepped. */
  tick?(world: World, dt: number, host: LabHost): void;
  /** Annotation drawn over the bodies. */
  annotate?(renderer: Renderer, world: World, pointer: PointerState): void;
  /**
   * A click on the canvas in a lab that is not `interactive`.
   *
   * Dragging would disturb a controlled setup, but selecting should not, so a
   * lab that edits its bodies one at a time gets the pick without having to
   * opt into the whole manipulation model.
   */
  onPick?(body: import("../physics/body").Body | null): void;

  /** Readout panels, built once when the lab is selected. */
  panels(world: World, host: LabHost): Panel[];
  /**
   * Switches offered in the console.
   *
   * Given the world because a switch that changes the simulation has to take
   * effect on the spot; deferring it to the next frame leaves a visible kink
   * in the motion at any appreciable acceleration.
   */
  toggles?(world: World, host: LabHost): Toggle[];
}
