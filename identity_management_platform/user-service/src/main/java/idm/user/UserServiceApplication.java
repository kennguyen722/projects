package idm.user;

import io.grpc.Server;
import io.grpc.ServerBuilder;
import org.springframework.boot.CommandLineRunner;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class UserServiceApplication implements CommandLineRunner {
  public static void main(String[] args){ SpringApplication.run(UserServiceApplication.class, args); }

  @Override
  public void run(String... args) throws Exception {
    Server server = ServerBuilder.forPort(8083).addService(new UserServiceImpl()).build();
    server.start();
    System.out.println("gRPC UserService started on 8083");
    Runtime.getRuntime().addShutdownHook(new Thread(server::shutdown));
    server.awaitTermination();
  }
}
