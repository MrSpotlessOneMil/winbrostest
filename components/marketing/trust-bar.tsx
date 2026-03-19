export function TrustBar() {
  return (
    <div className="bg-gray-50 border-y border-gray-200 py-4 px-4">
      <div className="max-w-5xl mx-auto grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-6">
        <div className="flex items-center gap-2 justify-center">
          <span className="text-amber-400">&#9733;</span>
          <span className="text-sm font-medium text-gray-700">
            5.0 Stars (29 Reviews)
          </span>
        </div>

        <div className="flex items-center gap-2 justify-center">
          <span className="text-sm font-medium text-gray-700">
            2,500+ Cleanings Completed
          </span>
        </div>

        <div className="flex items-center gap-2 justify-center">
          <span className="text-sm font-medium text-gray-700">
            Eco-Friendly Products
          </span>
        </div>

        <div className="flex items-center gap-2 justify-center">
          <span className="text-sm font-medium text-gray-700">
            Licensed & Insured
          </span>
        </div>
      </div>
    </div>
  );
}
