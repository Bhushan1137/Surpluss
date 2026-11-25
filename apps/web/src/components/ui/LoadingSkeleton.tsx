interface LoadingSkeletonProps {
  rows?: number;
}

export function LoadingSkeleton({ rows = 5 }: LoadingSkeletonProps) {
  return (
    <div className="animate-pulse space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-12 bg-gray-200 rounded-md" />
      ))}
    </div>
  );
}

export function StatsSkeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 animate-pulse">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-24 bg-gray-200 rounded-lg" />
      ))}
    </div>
  );
}
