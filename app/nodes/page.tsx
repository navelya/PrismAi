export default function NodesPage() {
    return (
        <div className="w-full h-full flex items-center justify-center">
            <div className="text-center space-y-4">
                <div className="w-20 h-20 mx-auto rounded-full bg-gradient-premium flex items-center justify-center">
                    <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                    </svg>
                </div>
                <h2 className="text-2xl font-bold text-gray-900">Node Catalog</h2>
                <p className="text-gray-600">Coming soon - Browse available node types</p>
            </div>
        </div>
    );
}
