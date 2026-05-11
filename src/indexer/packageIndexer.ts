import { PubspecLockProvider, PackageInfo } from '../providers/pubspecLockProvider';

export class PackageIndexer {
    static indexPackages(projectPath: string): PackageInfo[] {
        try {
            return PubspecLockProvider.getPackages(projectPath);
        } catch (error) {
            console.error('Error indexing packages:', error);
            return [];
        }
    }
}
