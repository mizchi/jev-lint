# Some Thoughts on the Direction of Software

Software is changing faster than at any point in its history, and it is worth pausing to consider where it is going. In this post I want to share some thoughts on a few trends I have been watching. They do not all point the same way, but together they paint a picture.

Type systems have become far more expressive in the last decade. Languages that once had no static types now have gradual typing, and languages that had simple types now have generics, union types and inference good enough that annotations are rare. This matters because types are documentation that cannot go stale.

Additionally, the cost of running code has collapsed. A function that would have needed a provisioned server now runs on demand and is billed by the millisecond. This has changed the economics of small services, and it has also changed how people think about state, because a process that lives for a hundred milliseconds cannot hold much of it.

On another note, developer tooling has consolidated. There used to be dozens of build tools for the web; now there are a few, and they mostly agree on what a project looks like. Consolidation is good for newcomers and bad for experimentation, and it is unclear which matters more.

Furthermore, security has become a first-class concern in ways that it was not. Supply chain attacks have made every dependency a liability, and the response has been lockfiles, signed packages and provenance attestations. Whether these measures are enough is an open question.

Meanwhile, the browser has become the universal runtime. Applications that once shipped as native binaries now ship as web applications, and the browser has grown APIs for file access, hardware and offline storage to accommodate them. This is convenient for distribution and worrying for anyone who cares about how much memory a text editor uses.

It is also worth noting that documentation has improved. Generated reference documentation is now standard, and many projects maintain examples that are tested in CI so they cannot rot. The gap between the documentation of a well-run open source project and that of an internal system has never been wider.

In the same vein, the number of people writing software has grown enormously. Many of them do not think of themselves as programmers. Spreadsheets, low-code tools and scripting inside applications have made writing small programs a normal part of many jobs.

At the same time, the profession has become more specialised. Front end, back end, infrastructure, data and machine learning are now separate careers with separate tools, and a person who is expert in one is often a beginner in another.

Taken together, these trends suggest that software is becoming both more accessible and more complex, more consolidated and more fragmented, more secure and more exposed. It is hard to say what this means. Perhaps the only safe prediction is that the field will look different again in ten years.
