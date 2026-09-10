// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice One resting price level on a DreamDEX event contract book.
/// @dev Field layout taken from the pinned starter template's
/// `solidity/src/IEventContracts.sol`, which flags this struct as the one to
/// confirm against the live ABI. It was confirmed: the pinned
/// `@somnia-chain/markets-sdk` declares the same two fields in the same order in
/// its own `BookLevel` interface, so two independent pinned sources agree
/// (DECISIONS.md D-012).
/// @dev `price` is a probability in the market's own units — 1e6 on testnet, where
/// one whole contract is `oneCollateral`. Assize stores the raw integer and never
/// converts it, because converting needs a scale and PRD §17 forbids compiling one
/// in (DECISIONS.md D-011).
struct OrderBookLevel {
    uint256 price;
    uint256 quantity;
}

/// @notice The subset of the DreamDEX binary pool that Assize reads.
/// @dev Deliberately narrow. PRD §5.4: Assize observes, records and settles bonds.
/// It never places an order, so nothing that writes to the book appears here.
/// Every signature is copied from the pinned template rather than recalled
/// (PRD §0.3).
interface IBinaryPool {
    /// @notice Resting levels on one side of the book, best price first.
    /// @param isBid True for the bid side, false for the ask side.
    /// @param numLevels How many levels to return.
    /// @dev Returns fewer levels than requested when the side is thin, and an
    /// empty array when the side is empty. An empty side is a real reading —
    /// PRD §14's "pull one side entirely" — and becomes `ABSENT`, not an error.
    function getBookLevels(bool isBid, uint64 numLevels)
        external
        view
        returns (OrderBookLevel[] memory);
}
