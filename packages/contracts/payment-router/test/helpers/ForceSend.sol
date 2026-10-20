// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

/// @dev Pushes its balance into `target` with `SELFDESTRUCT`, which a contract
///      cannot refuse: no `receive()` runs and no access check applies. That is
///      how a donation actually reaches a router, so the invariant suite sends
///      one this way instead of conjuring the balance with `vm.deal`, a cheatcode
///      the invariant runner does not always carry from one call to the next.
contract ForceSend {
    constructor(address payable target) payable {
        selfdestruct(target);
    }
}
