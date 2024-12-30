# Idolly Ai Client Service

## Overview
`UmiClient` is a service designed to interact with the Solana blockchain and facilitate operations such as uploading metadata to Irys, creating and managing NFT collections, minting compressed NFTs (cNFTs), and handling transactions efficiently. It leverages advanced tools like `@metaplex-foundation/umi`, `mpl-bubblegum`, and other Metaplex Foundation packages to provide a robust and scalable blockchain integration.

---

## Features
- **Irys Metadata Upload**: Uploads metadata in JSON format to Irys, ensuring secure and efficient storage.
- **Merkle Tree Deployment**: Creates and deploys Merkle Trees for cNFT minting using `mpl-bubblegum`.
- **NFT Collection Management**: Creates NFT collections with customized metadata and integrates them seamlessly with Solana's token metadata program.
- **Compressed NFT Minting (cNFT)**: Mints compressed NFTs with metadata and ownership details using efficient tree-based structures.
- **Transaction Management**: Provides utility functions to handle transaction building, retries, confirmations, and fee calculations.

---

## Key Technologies
- **Programming Language**: TypeScript
- **Framework**: [NestJS](https://nestjs.com/)
- **Blockchain**: [Solana](https://solana.com/)
- **Libraries**:
  - [`@metaplex-foundation/umi`](https://github.com/metaplex-foundation/umi)
  - [`mpl-bubblegum`](https://github.com/metaplex-foundation/mpl-bubblegum)
  - [`mpl-token-metadata`](https://github.com/metaplex-foundation/mpl-token-metadata)
  - [`@solana/web3.js`](https://github.com/solana-labs/solana-web3.js)

---

## Environment Setup
Ensure you have the following environment variables configured:
- `HELIUS_RPC_URL`: RPC URL for connecting to Solana
- `MERKLE_TREE`: Public key of the Merkle Tree for cNFT minting
- `CNFT_COLLECTION`: Public key of the NFT collection for minting
- `NODE_ENV`: Specifies the environment (`production`, `dev`, etc.)

---

## Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd <repository-directory>
