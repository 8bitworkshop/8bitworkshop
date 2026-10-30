# Debug Tree

The Debug Tree shows a hierarchical view of platform debug information.
It is available on platforms that implement `getDebugTree`.

The tree's shape is defined by the platform. Where the
[Call Graph](callgraph.md) reconstructs call flow from observed
execution, the Debug Tree exposes whatever structured state the machine
implements — device registers, internal tables, subsystem state — as an
expandable tree.

## How values are shown

- Numbers are shown in decimal with their hex value.
- Booleans and strings are shown as-is.
- Byte arrays are shown as a short hex dump.
- Objects and functions expand to their properties. Functions marked as
  lazy are only called when the node is expanded.
- Large arrays are split into `$offset` chunks on demand.
- Maps are shown as their key/value pairs.

Nodes collapse and expand on click. The tree refreshes with the emulator
while debugging.

## Source variables

A build can carry source-level variables with their home addresses and
live ranges. urust reports them in its `--debug-out` JSON, and the tree
then shows a **Locals** node: the variables whose code range contains the
current PC, with their values read from memory. A reassigned variable
appears once, at the definition that is live at the PC; cells overlaid by
other variables are not shown. Values the optimizer kept no storage for
appear as `<optimized out>`, never as a guess.

Selecting a variable in the editor shows its live value in the same way,
and `8bws run ... -e "tree Locals"` prints the node from the CLI.
