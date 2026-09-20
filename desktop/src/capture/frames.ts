/**
 * Injected into every subframe. The module registers its own `message`
 * listener as a side effect of loading, which is how the top frame's capture
 * reaches iframe content — without it an embedded tweet or video player
 * archives as an empty box.
 */
import "single-file-core/single-file-frames.js";
