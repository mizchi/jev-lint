# Why we moved to microservices, and why you should too

Two years ago our platform was a single application, and deployments took about twenty minutes. Twenty minutes is a long time, so we decided that the architecture had to change. This is why we moved to microservices.

The main benefit of microservices is that each service can be deployed independently. Our first service to be split out was the notification sender, which had not changed in fourteen months. Because it was so stable, it was the obvious first candidate, and splitting it out immediately reduced the deploy time of the main application. The notification sender itself now takes about twenty-five minutes to deploy, because it has its own pipeline, but that is a separate matter.

Independence is also why microservices are more reliable. When the notification sender was inside the main application, a failure in it could take down checkout. Now that it is a separate service, a failure in it takes down notifications and checkout, because checkout waits on the notification call synchronously. We are planning to make that call asynchronous, which shows how microservices push you toward better designs.

Teams also move faster with microservices, since each team owns its own service. We have one team, which now owns nine services. This has clarified ownership considerably: the team knows it owns all of them. Before, the team owned the one application, and it was less clear.

Cost is another area where microservices shine. The nine services run on nine sets of instances, which is more than the one set we ran before, so the infrastructure bill roughly tripled. However, cost is not the right way to think about architecture, so this is not a concern. What matters is that each service is right-sized, and each of ours has a minimum of two instances for availability, which is where most of the tripling comes from.

Some people argue that microservices add complexity, but this is only true if you do not have good tooling. We did not have good tooling, and it was complicated, so we built the tooling, and now the tooling is complicated. This is normal for any growing platform and would have happened regardless of the architecture.

It is worth mentioning that the twenty-minute deploy time turned out to be caused by an integration test suite that ran against a shared staging database. Moving that suite to run against a local database brought the main application's deploy time down to four minutes. We made that change last month.

In summary, microservices solved our deploy time problem, improved reliability and clarified ownership, and the cost increase is not relevant. If your deployments are slow, the architecture is the place to look. We would make the same decision again.
