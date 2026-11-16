import {
  verifyNestArchitecture,
  type ArchitectureException,
  type ArchitectureFinding,
  type NestArchitectureOptions,
} from '@cadenway/nest-testing/architecture';

interface PublishedException {
  readonly file: string;
  readonly rule: string;
  readonly reason: string;
}

declare const publishedOptions: {
  readonly rootDir: string;
  readonly tsconfig: string;
  readonly profile: 'service' | 'gateway' | 'kit';
  readonly convention?: 'strict';
  readonly exceptions?: readonly PublishedException[];
};
declare const publishedException: PublishedException;

const options: NestArchitectureOptions = publishedOptions;
const exception: ArchitectureException = publishedException;
const findings: readonly {
  readonly file: string;
  readonly line: number;
  readonly rule: string;
  readonly message: string;
}[] = verifyNestArchitecture({ ...options, exceptions: [exception] });

const publishedFindings: readonly ArchitectureFinding[] = findings;
