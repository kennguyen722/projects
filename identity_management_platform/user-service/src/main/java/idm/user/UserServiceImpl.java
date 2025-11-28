package idm.user;

import idm.user.v1.*; // using java_multiple_files option generates classes per message
import io.grpc.stub.StreamObserver;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

public class UserServiceImpl extends UserServiceGrpc.UserServiceImplBase {
  private final Map<String, User> store = new ConcurrentHashMap<>();

  @Override
  public void createUser(CreateUserRequest request, StreamObserver<UserResponse> responseObserver) {
    User incoming = request.getUser();
    String id = UUID.randomUUID().toString();
    User created = User.newBuilder(incoming).setId(id).build();
    store.put(id, created);
    responseObserver.onNext(UserResponse.newBuilder().setUser(created).build());
    responseObserver.onCompleted();
  }

  @Override
  public void getUser(GetUserRequest request, StreamObserver<UserResponse> responseObserver) {
    User user = store.get(request.getId());
    if(user==null){ responseObserver.onError(new NoSuchElementException("User not found")); return; }
    responseObserver.onNext(UserResponse.newBuilder().setUser(user).build());
    responseObserver.onCompleted();
  }

  @Override
  public void listUsers(ListUsersRequest request, StreamObserver<ListUsersResponse> responseObserver) {
    List<User> users = new ArrayList<>(store.values());
    responseObserver.onNext(ListUsersResponse.newBuilder().addAllUsers(users).setTotal(users.size()).build());
    responseObserver.onCompleted();
  }

  @Override
  public void updateUser(UpdateUserRequest request, StreamObserver<UserResponse> responseObserver) {
    User u = request.getUser();
    if(!store.containsKey(u.getId())){ responseObserver.onError(new NoSuchElementException("User not found")); return; }
    store.put(u.getId(), u);
    responseObserver.onNext(UserResponse.newBuilder().setUser(u).build());
    responseObserver.onCompleted();
  }

  @Override
  public void deleteUser(DeleteUserRequest request, StreamObserver<DeleteUserResponse> responseObserver) {
    boolean deleted = store.remove(request.getId()) != null;
    responseObserver.onNext(DeleteUserResponse.newBuilder().setDeleted(deleted).build());
    responseObserver.onCompleted();
  }
}
