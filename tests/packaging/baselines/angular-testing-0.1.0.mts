import {
  verifyAngularArchitecture,
  type AngularArchitectureOptions,
  type ArchitectureException,
  type ArchitectureFinding,
} from '@cadenway/angular-testing/architecture';

interface PublishedException {
  readonly file: string;
  readonly rule: string;
  readonly reason: string;
}

declare const publishedOptions: {
  readonly rootDir: string;
  readonly tsconfig: string;
  readonly profile: 'application' | 'library';
  readonly roots?: readonly string[];
  readonly exceptions?: readonly PublishedException[];
};
declare const publishedException: PublishedException;

const options: AngularArchitectureOptions = publishedOptions;
const exception: ArchitectureException = publishedException;
const findings: readonly {
  readonly file: string;
  readonly line: number;
  readonly rule: string;
  readonly message: string;
}[] = verifyAngularArchitecture({ ...options, exceptions: [exception] });

const publishedFindings: readonly ArchitectureFinding[] = findings;
