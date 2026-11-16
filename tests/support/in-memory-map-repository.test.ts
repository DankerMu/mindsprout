import { describeMapRepositoryContract } from './map-repository-contract';
import { InMemoryMapRepository } from './in-memory-map-repository';

describeMapRepositoryContract('InMemoryMapRepository', () => new InMemoryMapRepository());
