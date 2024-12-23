import { Injectable, Logger, LoggerService } from '@nestjs/common';
import { UmiPort } from './umi.port';
import { Err, Ok, Result } from 'oxide.ts';
import { irysUploader } from '@metaplex-foundation/umi-uploader-irys';
import { clusterApiUrl } from '@solana/web3.js';
import { createGenericFile } from '@metaplex-foundation/umi';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  CreateTransactionBuilderException,
  FetchCnftInfoFailException,
  RequestIrysUploadFailException,
  WalletBuildTreeFailException,
  WalletCreateKeypairFailException,
  WalletCreateNftCollectionFailException,
  WalletFailedSendUmiTxException,
  WalletMintCnftFailException,
} from '../../errors/wallet.error';
import {
  transactionBuilder,
  TransactionBuilder,
  publicKey as UMIPublicKey,
  generateSigner,
  keypairIdentity,
  percentAmount,
} from '@metaplex-foundation/umi';
import {
  createTree,
  findLeafAssetIdPda,
  LeafSchema,
  mintToCollectionV1,
  mplBubblegum,
  parseLeafFromMintToCollectionV1Transaction,
  SPL_NOOP_PROGRAM_ID,
} from '@metaplex-foundation/mpl-bubblegum';
import { dasApi } from '@metaplex-foundation/digital-asset-standard-api';
import { getExplorerLink } from '@solana-developers/helpers';
import {
  createNft,
  fetchDigitalAsset,
  mplTokenMetadata,
} from '@metaplex-foundation/mpl-token-metadata';
import bs58 from 'bs58';
import {
  ChangeLogEventV1,
  deserializeChangeLogEventV1,
} from '@solana/spl-account-compression';

@Injectable()
export class UmiClient implements UmiPort {
  private readonly umi;
  private readonly MERKLE_TREE = process.env.MERKLE_TREE;
  private readonly CNFT_COLLECTION = process.env.CNFT_COLLECTION;
  private readonly logger: LoggerService = new Logger('UmiClient');

  constructor() {
    const env = process.env.NODE_ENV;

    this.umi = createUmi(process.env.HELIUS_RPC_URL).use(irysUploader());
    this.logger.log(
      `UmiClient initialized for ${
        env === 'production' ? 'Mainnet' : 'Devnet'
      }`,
    );
  }

  async uploadIrys(
    data: any,
    key: any,
  ): Promise<Result<any, RequestIrysUploadFailException>> {
    try {
      if (!data || !key) {
        this.logger.error('Invalid data or key for Irys upload');
        return Err(new RequestIrysUploadFailException('Invalid data or key'));
      }

      if (!(key instanceof Uint8Array) || key.length !== 64) {
        this.logger.error(
          'Invalid key format, must be Uint8Array of length 64',
        );
        return Err(new RequestIrysUploadFailException('Invalid key format'));
      }

      const umiKeypair = await this.umi.eddsa.createKeypairFromSecretKey(key);
      this.umi.use(keypairIdentity(umiKeypair));

      const jsonString = JSON.stringify(data);
      const genericFile = createGenericFile(
        Buffer.from(jsonString),
        'metadata.json',
        { contentType: 'application/json' },
      );

      const uriUploadArray = await this.umi.uploader.upload([genericFile]);

      if (!uriUploadArray || uriUploadArray.length === 0) {
        this.logger.error('Failed to upload Irys data');
        return Err(
          new RequestIrysUploadFailException('Failed to upload Irys data'),
        );
      }

      return Ok(uriUploadArray);
    } catch (error) {
      this.logger.error('Failed to upload Irys', error.message, error.stack);
      return Err(new RequestIrysUploadFailException());
    }
  }

  async createTree(
    umiKeypair: any,
  ): Promise<Result<any, WalletBuildTreeFailException>> {
    try {
      this.umi
        .use(keypairIdentity(umiKeypair))
        .use(mplBubblegum())
        .use(dasApi());

      const merkleTree = generateSigner(this.umi);
      const builder = await createTree(this.umi, {
        merkleTree,
        maxDepth: 14,
        maxBufferSize: 64,
      });
      await builder.sendAndConfirm(this.umi);

      const explorerLink = getExplorerLink(
        'address',
        merkleTree.publicKey,
        'devnet',
      );

      return Ok(explorerLink);
    } catch (error) {
      this.logger.error(
        'Failed to deploy merkle tree',
        error.message,
        error.stack,
      );

      return Err(new WalletBuildTreeFailException());
    }
  }

  async createNftCollection(
    umiKeypair: any,
    uri: string,
  ): Promise<Result<any, WalletCreateNftCollectionFailException>> {
    try {
      this.umi.use(keypairIdentity(umiKeypair));

      this.umi.use(mplTokenMetadata());

      const collectionMint = generateSigner(this.umi);

      const transaction = await createNft(this.umi, {
        mint: collectionMint,
        name: 'IDOLLY.AI',
        symbol: 'IDOL',
        uri: uri,
        sellerFeeBasisPoints: percentAmount(0),
        isCollection: true,
      });

      await transaction.sendAndConfirm(this.umi);

      const createdCollectionNft = await fetchDigitalAsset(
        this.umi,
        collectionMint.publicKey,
      );

      return Ok(createdCollectionNft.mint.publicKey);
    } catch (error) {
      this.logger.error(
        'Failed to create nft collection',
        error.message,
        error.stack,
      );

      return Err(new WalletCreateNftCollectionFailException());
    }
  }

  async retryParseLeaf(
    umi: any,
    uintSig: Uint8Array,
    maxRetries = 20,
    delay = 1000,
  ): Promise<LeafSchema> {
    let attempts = 0;
    while (attempts < maxRetries) {
      try {
        const leaf = await parseLeafFromMintToCollectionV1Transaction(
          umi,
          uintSig,
        );
        return leaf; 
      } catch (error) {
        attempts += 1;
        if (attempts < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, delay)); // Wait before retrying
        }
      }
    }
    throw new Error('Failed to parse leaf after multiple attempts');
  }

  async mintCnft(
    umiKeypair: any,
    uri: string,
    addr: string,
  ): Promise<Result<any, WalletMintCnftFailException>> {
    try {
      this.umi.use(keypairIdentity(umiKeypair));

      this.umi
        .use(keypairIdentity(umiKeypair))
        .use(mplBubblegum())
        .use(dasApi());

      const merkleTree = UMIPublicKey(this.MERKLE_TREE);

      const collectionMint = UMIPublicKey(this.CNFT_COLLECTION);

      const ownerPublicKey = UMIPublicKey(addr);

      const mintTransaction = await mintToCollectionV1(this.umi, {
        leafOwner: ownerPublicKey,
        merkleTree,
        collectionMint,
        metadata: {
          name: 'IDOLLY AI',
          symbol: 'IDOL',
          uri: uri,
          sellerFeeBasisPoints: 0, 
          collection: { key: collectionMint, verified: false },
          creators: [
            {
              address: this.umi.identity.publicKey,
              verified: false,
              share: 100,
            },
          ],
        },
      }).sendAndConfirm(this.umi);

      const uintSig = mintTransaction.signature;

      const leaf = await this.retryParseLeaf(this.umi, uintSig);

      const assetId = findLeafAssetIdPda(this.umi, {
        merkleTree,
        leafIndex: leaf.nonce,
      });

      this.logger.log('Asset ID:', assetId[0]);

      return Ok(assetId[0]);
    } catch (error) {
      this.logger.error('Failed to mint Cnft', error.message, error.stack);

      return Err(new WalletMintCnftFailException());
    }
  }

  async mintCnftInstruction(
    key: string,
    umiKeypair: any,
    uri: string,
    addr: string,
  ): Promise<Result<any, WalletMintCnftFailException>> {
    try {
      this.umi.use(keypairIdentity(umiKeypair));
      this.umi.use(mplBubblegum()).use(dasApi());

      const merkleTree = UMIPublicKey(this.MERKLE_TREE);
      const collectionMint = UMIPublicKey(this.CNFT_COLLECTION);
      const ownerPublicKey = UMIPublicKey(addr);

      const mintBuilder = await mintToCollectionV1(this.umi, {
        leafOwner: ownerPublicKey,
        merkleTree,
        collectionMint,
        metadata: {
          name: `IDOLLY AI #${key}`,
          symbol: 'IDOL',
          uri: uri,
          sellerFeeBasisPoints: 0, // 0%
          collection: { key: collectionMint, verified: false },
          creators: [
            {
              address: this.umi.identity.publicKey,
              verified: false,
              share: 100,
            },
          ],
        },
      });

      return Ok(mintBuilder);
    } catch (error) {
      this.logger.error('Failed to mint Cnft', error.message, error.stack);

      return Err(new WalletMintCnftFailException());
    }
  }

  async fetchCnftInfo(
    cnftAddress: string,
  ): Promise<Result<any, FetchCnftInfoFailException>> {
    try {
      this.umi.use(mplBubblegum()).use(dasApi());

      const assetId = UMIPublicKey(cnftAddress);

      const rpcAsset = await this.umi.rpc.getAsset(assetId);

      return Ok(rpcAsset);
    } catch (error) {
      this.logger.error('Failed to fetch Cnft', error.message, error.stack);

      return Err(new FetchCnftInfoFailException());
    }
  }

  async sendTransactionWithHash(
    transactionBuilder: TransactionBuilder,
    umiKeypair: any,
    options: { blockhash?: string; lastValidBlockHeight?: number } = {}, // Accept both blockhash and lastValidBlockHeight
  ): Promise<Result<any, WalletFailedSendUmiTxException>> {
    try {
      if (!transactionBuilder || !umiKeypair) {
        this.logger.error('Invalid transaction or keypair');
        return Err(
          new WalletFailedSendUmiTxException('Invalid transaction or keypair'),
        );
      }

      this.umi.use(keypairIdentity(umiKeypair));
      this.logger.log(
        'Transaction builder before sending:',
        transactionBuilder,
      );

      let retries = 0;
      const maxRetries = 10;
      let confirmResult;

      const { blockhash, lastValidBlockHeight } = options;

      let blockhashToUse, validBlockHeight;
      if (!blockhash || !lastValidBlockHeight) {
        const blockhashInfo = await this.umi.rpc.getLatestBlockhash();
        blockhashToUse = blockhashInfo.blockhash;
        validBlockHeight = blockhashInfo.lastValidBlockHeight;
      } else {
        blockhashToUse = blockhash;
        validBlockHeight = lastValidBlockHeight;
      }

      this.logger.log(
        `Using blockhash: ${blockhashToUse}, lastValidBlockHeight: ${validBlockHeight}`,
      );

      while (retries < maxRetries) {
        try {
          confirmResult = await transactionBuilder.sendAndConfirm(this.umi, {
            send: { skipPreflight: false },
            confirm: {
              strategy: {
                type: 'blockhash',
                blockhash: blockhashToUse,
                lastValidBlockHeight: validBlockHeight, 
              },
              commitment: 'finalized',
            },
          });
          break;
        } catch (error) {
          retries++;
          this.logger.error(
            `Retry ${retries}: Transaction failed - ${error.message}`,
          );
          if (retries === maxRetries) {
            throw new Error('Transaction failed after maximum retries');
          }
        }
      }

      this.logger.log(
        `Transaction successfully confirmed with result: ${confirmResult}`,
      );

      let txHash: any;

      if (confirmResult.signature instanceof Uint8Array) {
        txHash = bs58.encode(confirmResult.signature);
      } else if (typeof confirmResult.signature === 'string') {
        txHash = confirmResult.signature;
      } else {
        this.logger.error(
          'Unexpected signature type:',
          typeof confirmResult.signature,
        );
        return Err(
          new WalletFailedSendUmiTxException('Unexpected signature format'),
        );
      }

      const transactionDetails = await this.umi.rpc.getTransaction(
        confirmResult.signature,
        {
          commitment: 'finalized',
        },
      );

      if (!transactionDetails || !transactionDetails.meta) {
        this.logger.error('Failed to fetch transaction details for fee info');
        return Err(
          new WalletFailedSendUmiTxException(
            'Failed to get transaction details',
          ),
        );
      }

      const feeUsed = transactionDetails.meta.fee; 
      this.logger.log(`Transaction Fee Used: ${feeUsed}`);

      const solFee =
        Number(feeUsed.basisPoints) / Math.pow(10, feeUsed.decimals);

      return Ok({ confirmResult, txHash, solFee });
    } catch (error) {
      this.logger.error(
        'Failed to send transaction',
        error.message,
        error.stack,
      );
      return Err(
        new WalletFailedSendUmiTxException(
          'Failed to send and confirm transaction',
        ),
      );
    }
  }

  async sendTransaction(
    transactionBuilder: TransactionBuilder,
    umiKeypair: any,
  ): Promise<Result<any, WalletFailedSendUmiTxException>> {
    try {
      if (!transactionBuilder || !umiKeypair) {
        this.logger.error('Invalid transaction or keypair');
        return Err(
          new WalletFailedSendUmiTxException('Invalid transaction or keypair'),
        );
      }

      this.umi.use(keypairIdentity(umiKeypair));

      let retries = 0;
      const maxRetries = 10;
      let confirmResult;
      while (retries < maxRetries) {
        try {
          confirmResult = await transactionBuilder.sendAndConfirm(this.umi, {
            send: { skipPreflight: false },
            confirm: {
              strategy: {
                type: 'blockhash',
                ...(await this.umi.rpc.getLatestBlockhash()),
              },
              commitment: 'finalized',
            },
          });
          break; 
        } catch (error) {
          retries++;

          if (retries === maxRetries) {
            throw new Error('Transaction failed after maximum retries');
          }
        }
      }

      this.logger.log(
        `Transaction successfully confirmed with result: ${confirmResult}`,
      );

      let txHash: any;

      if (confirmResult.signature instanceof Uint8Array) {
        txHash = bs58.encode(confirmResult.signature);
      } else if (typeof confirmResult.signature === 'string') {
        txHash = confirmResult.signature;
      } else {
        this.logger.error(
          'Unexpected signature type:',
          typeof confirmResult.signature,
        );
        return Err(
          new WalletFailedSendUmiTxException('Unexpected signature format'),
        );
      }

      const transactionDetails = await this.umi.rpc.getTransaction(
        confirmResult.signature,
        {
          commitment: 'confirmed',
        },
      );

      if (!transactionDetails || !transactionDetails.meta) {
        this.logger.error('Failed to fetch transaction details for fee info');
        return Err(
          new WalletFailedSendUmiTxException(
            'Failed to get transaction details',
          ),
        );
      }

      const feeUsed = transactionDetails.meta.fee; 

      this.logger.log(`Transaction Fee Used: 
          basisPoints: ${feeUsed.basisPoints}, 
          identifier: ${feeUsed.identifier}, 
          decimals: ${feeUsed.decimals}`);

      const solFee =
        Number(feeUsed.basisPoints) / Math.pow(10, feeUsed.decimals);

      return Ok({ confirmResult, txHash, solFee });
    } catch (error) {
      this.logger.error(
        'Failed to send transaction',
        error.message,
        error.stack,
      );
      return Err(
        new WalletFailedSendUmiTxException(
          'Failed to send and confirm transaction',
        ),
      );
    }
  }

  createTransactionBuilder(): Result<
    TransactionBuilder,
    CreateTransactionBuilderException
  > {
    try {
      const builder = transactionBuilder();

      return Ok(builder);
    } catch (error) {
      this.logger.error(
        'Failed to create transaction builder',
        error.message,
        error.stack,
      );
      return Err(new CreateTransactionBuilderException());
    }
  }
}
