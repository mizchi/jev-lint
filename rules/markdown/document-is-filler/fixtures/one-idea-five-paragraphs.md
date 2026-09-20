# Why You Should Always Write the Test First

The single most important habit a developer can build is writing the test before the code. When you write the test first, you are forced to think about what the code should do before you think about how it should do it. This changes the way you write software, because the interface is designed from the point of view of the caller rather than the implementer. Writing the test first is not a technique; it is a way of thinking.

Consider what happens when you write the test first. Before a single line of implementation exists, you have to decide what the function is called, what it takes, and what it returns. You have to decide what a successful result looks like. In other words, writing the test first makes you design the interface before you design the implementation. This is the whole point. The test is the first caller, and the first caller shapes the API.

This is why writing the test first matters so much. If you write the implementation first, you will design the interface around whatever was convenient to implement. If you write the test first, you will design the interface around whatever is convenient to call. The difference is subtle but it compounds over time. A codebase where tests were written first has interfaces that were designed to be used; a codebase where tests were written after has interfaces that were designed to be built.

Some developers argue that writing the test first slows them down. It is true that it takes a little longer to write the test before the code. But that time is repaid many times over, because the test forces you to think about the interface before you commit to an implementation. Writing the test first is an investment in the design of your code. It slows you down at the start so that you can go faster later.

There is also a psychological benefit to writing the test first. When the test exists before the code, you have a clear definition of done. You know exactly when you are finished, because the test passes. This clarity comes from having decided, in the test, what the code should do before deciding how it should do it. The test first approach gives you a target, and having a target changes how you work.

So the next time you sit down to write code, write the test first. Decide what the code should do before you decide how it should do it. Design the interface from the caller's side. Let the test be the first user of your code. It is the single most important habit you can build, and it will change the way you write software.
