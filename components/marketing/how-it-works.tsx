export function HowItWorks() {
  return (
    <section className="py-16 px-4 bg-white border-b border-gray-200">
      <div className="max-w-4xl mx-auto">
        <p className="text-sm font-medium text-[#2195b4] mb-3 text-center">
          How it works
        </p>
        <h2 className="text-3xl font-bold text-center text-gray-900 mb-12">
          Three Steps to a Clean Home
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
          <div className="text-center">
            <div className="text-4xl font-bold text-[#2195b4] mb-3">01</div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              Tell Us What You Need
            </h3>
            <p className="text-sm text-gray-600">
              Call, text, or fill out the form. Let us know what kind of cleaning
              you need and we will figure out the rest.
            </p>
          </div>

          <div className="text-center">
            <div className="text-4xl font-bold text-[#2195b4] mb-3">02</div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              Instantly Confirmed
            </h3>
            <p className="text-sm text-gray-600">
              Your appointment is confirmed right away. We match you with
              the right crew and lock in your date — no waiting.
            </p>
          </div>

          <div className="text-center">
            <div className="text-4xl font-bold text-[#2195b4] mb-3">03</div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              We Show Up and Get It Done
            </h3>
            <p className="text-sm text-gray-600">
              Our team arrives on time, cleans everything top to bottom, and
              leaves your place feeling brand new. Simple as that.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
