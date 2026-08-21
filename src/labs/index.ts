import { CollisionsLab } from "./collisions";
import { GasLab } from "./gas";
import { GravityLab } from "./gravity";
import { TableLab } from "./table";
import type { Lab } from "./types";

export const labs: Lab[] = [new CollisionsLab(), new GasLab(), new GravityLab(), new TableLab()];

export type { Lab, LabHost, PointerState, Toggle } from "./types";
