import { createContext } from "react";

/** Reveal clocks stop even when a pooled transcript stays mounted. */
export const TranscriptVisibility = createContext(true);

/** Whether streamed text is paced; on for every transcript. */
export const TranscriptPacing = createContext(true);
